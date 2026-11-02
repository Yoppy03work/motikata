// Reminder テーブルから「今送るべきもの」を引き、チャネル別に発射する。
// 設計:
// - 1 バッチ最大 BATCH_SIZE 件。worker が毎分叩くので大きい必要はない。
// - 失敗は attempts++、3回失敗で FAILED。
// - 紐づく TaskInstance が既に DONE/SKIPPED ならその Reminder は SKIPPED。
// - 送り先は Reminder.channel(SLACK / PUSH / DISCORD / LINE / ALL)。実際の送信は notify.deliver。
//
// 並行性:
//   - 送信前に atomic な「claim」(claimedAt セット)で同一行への並行 dispatch を防ぐ。
//     claim 時点では attempts は増やさず、送信成功/失敗時にのみ attempts++ する
//     設計にして、クラッシュやタイムアウトでリトライ枠を浪費しない。
//
//   - 完了競合の防止 (Codex P2 3333055217 / 3333105585 / 3333664326):
//     完了競合に関する歴史:
//       v1: 送信前後で別 tx → completion が割り込むと送信後に SKIPPED→SENT
//           で上書きするレースがあった。
//       v2: tx 内で Reminder を pre-mark SENT に倒す → クラッシュで送信が
//           一度も走らないまま SENT 永続化される失通知バグになった。
//       v3: tx は status 確認のみ、送信は tx 外で CAS 確定 + completion 側で
//           claimedAt 保護 → クラッシュ時は再送される(at-least-once)が、
//           「送信中に completion が走ると外部通知だけ飛ぶ」(=ユーザが
//            ちょうど完了したタスクの通知が後から届く)は残っていた。
//
//     現状の方針 (v4):
//       FOR UPDATE トランザクションを「外部送信が終わるまで」開いたままに
//       して、TaskInstance 行ロックを保持しながら Slack/Push を実行する。
//       これにより:
//         - 送信前: status=OPEN を確認し、OPEN でなければ Reminder SKIPPED
//           に倒して送信せず終了。
//         - 送信中: completion 側は同じ TaskInstance 行ロックを取りに来る
//           ので、ここで必ず待たされる。送信終了 + Reminder 更新まで
//           完了が割り込めない。
//         - 送信後: 同じ tx 内で Reminder を SENT に確定。commit。
//         - クラッシュ: tx ロールバック → Reminder は PENDING + 古い
//           claimedAt のまま残り、STALE_CLAIM_MS 経過後に pickup される。
//           外部送信が完了済みだった場合は二重配信になり得るが、これは
//           「失通知より二重通知の方がマシ」という at-least-once 設計の
//           範囲内。
//       コスト: 外部 HTTP 中に DB 行ロックを保持するので、completion 側を
//       max 60s 待たせる可能性がある。Slack webhook / Web Push は通常
//       数百 ms で、worker 側にも 180s タイムアウトが入っているので
//       実用上は数秒以下のロック保持。
//
//     completion (/api/tasks/[id]/complete) 側の補強:
//       Reminder.status=PENDING を SKIPPED に倒す updateMany には
//       「claimedAt IS NULL OR claimedAt < stale」の AND を追加する。
//       これによって dispatch が完了通報を逃して claimedAt だけ残った稀な
//       窓(本来 v4 の lock で防がれるはずだが念のため)でも、completion
//       は dispatch の道に触らない。
//
//   - Push が「購読者あり・全件配信失敗」のケースは SENT ではなく PENDING/FAILED
//     扱いにして再試行を許容する。
//
// 停止明け(Mac のスリープ・Docker の停止など):
//   - 予定時刻から LATE_MS 以上遅れたリマインダーは 1 件ずつ送らず、停止していた時間と
//     一緒に 1 通にまとめて送る(missedReminders.ts)。
//   - まとめ通知は TaskInstance の行ロックを取らずに送る。複数タスク分を 1 通にするので
//     ロックを持ち続けられないため。送信の直前に完了したタスクが 1 行混ざる程度で、実害は小さい。

import { formatInTimeZone } from "date-fns-tz";
import { ja } from "date-fns/locale/ja";
import { prisma } from "@/lib/db";
import { formatMinutes } from "@/lib/formatMinutes";
import { deliver } from "@/lib/notify";
import { buildMissedMessage, isLate, type MissedItem, type Outage } from "@/lib/missedReminders";
import { pingWatchdog, recordHeartbeat } from "@/lib/watchdog";
import type { NotifyMessage } from "@/lib/notifyConfig";
import {
  createSubmissionChecker,
  manabaUrlOf,
  markManabaSubmitted,
  MANABA_DEADLINE_LEVEL,
} from "@/lib/manabaDeadline";
import { APP_TZ } from "@/lib/tz";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;
// claimedAt が古ければ「クラッシュ中に放置された」と見なして再 claim を許可。
// dispatch ジョブ自体に 180s タイムアウトを掛けているので、その十分上の値にする。
const STALE_CLAIM_MS = 5 * 60_000;

export type DispatchSummary = {
  sent: number;
  failed: number;
  skipped: number;
  examined: number;
  // 停止明けにまとめて送った(または送ろうとした)件数
  late: number;
  // 直前まで止まっていた分数(止まっていなければ 0)
  outageMin: number;
};

/** PENDING のリマインダーを claimedAt セットで原子的に占有する。
 *  claim 時点では attempts は増やさない: 送信完了(成功/失敗)時にのみ
 *  attempts++ する設計にして、クラッシュ/タイムアウトでリトライ枠を
 *  無駄に消費しないようにする。
 *
 *  排他は claimedAt の NULL → not-NULL transition + 行ロックで実現。
 *  既に他 dispatcher が claimedAt をセットしていれば WHERE が外れるので
 *  count=0 で claim 失敗となる。
 *
 *  ただし stale (5分以上前) な claimedAt は「処理途中で消滅した」として
 *  上書きを許可する。worker callJob が 180s でタイムアウトするので、
 *  STALE_CLAIM_MS はその余裕の上に設定。 */
async function tryClaim(reminderId: number): Promise<boolean> {
  const stale = new Date(Date.now() - STALE_CLAIM_MS);
  const res = await prisma.reminder.updateMany({
    where: {
      id: reminderId,
      status: "PENDING",
      OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }],
    },
    data: { claimedAt: new Date() },
  });
  return res.count > 0;
}

export async function dispatchPendingReminders(): Promise<DispatchSummary> {
  const now = new Date();
  const outage = await recordHeartbeat(now);
  // 外部の見張り(登録されていれば)。失敗しても配信は続ける
  await pingWatchdog({ now }).catch(() => undefined);
  const staleClaim = new Date(now.getTime() - STALE_CLAIM_MS);

  const pending = await prisma.reminder.findMany({
    where: {
      status: "PENDING",
      remindAt: { lte: now },
      attempts: { lt: MAX_ATTEMPTS },
      // 他 dispatcher が処理中(claimedAt が新しい)行はスキップ。
      // ただし stale な claim は処理が落ちている前提で再 pickup を許す。
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
    },
    include: {
      instance: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          itemType: true,
          required: true,
          priority: true,
          status: true,
          sourceExternalId: true,
        },
      },
    },
    orderBy: { remindAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  // manaba の締切直前チェックがあるバッチでだけ、1 回ログインして使い回す
  const checkSubmission = createSubmissionChecker();
  const missed: { id: number; attempts: number; item: MissedItem }[] = [];

  for (const r of pending) {
    // 1) atomic claim (claimedAt セット、attempts はまだ増やさない)
    const claimed = await tryClaim(r.id);
    if (!claimed) {
      // 既に他の dispatcher / 並行処理が拾った
      continue;
    }
    // 止まっていて予定時刻を大きく過ぎたもの: あとで 1 通にまとめる
    if (isLate(r.remindAt, now)) {
      const late = await classifyLate(r, now, checkSubmission);
      if (typeof late === "string") {
        await prisma.reminder.update({
          where: { id: r.id },
          data: { status: "SKIPPED", lastError: late, claimedAt: null },
        });
        skipped++;
        continue;
      }
      if (late) {
        missed.push({ id: r.id, attempts: r.attempts, item: late });
        continue;
      }
      // null: 締切前の manaba チェックなので、遅れていても通常どおり確認して送る
    }
    // manaba 締切直前チェック: 送る前に manaba で提出状況を確認する
    if (r.escalationLevel === MANABA_DEADLINE_LEVEL) {
      const skipReason = await precheckManabaDeadline(r, checkSubmission);
      if (skipReason) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: { status: "SKIPPED", lastError: skipReason, claimedAt: null },
        });
        skipped++;
        continue;
      }
    }

    // 送信失敗時に attempts++ する。成功時は attempts は据え置きでも問題ない
    // (MAX_ATTEMPTS は失敗回数の上限という設計に揃える)。
    const nextAttempts = r.attempts + 1;
    const willBeFailed = nextAttempts >= MAX_ATTEMPTS;

    // 2) 配信判断と外部送信を 1 トランザクション内で行う。
    //    TaskInstance を FOR UPDATE で押さえながら Slack / Push を実行
    //    することで、completion が割り込んで通知だけ飛ぶ事故を防ぐ。
    //    Prisma の interactive tx は既定で 5s タイムアウトなので、外部
    //    HTTP の余裕を持たせて 60s に延ばす(slack webhook は 30s 程度で
    //    タイムアウトする想定 + 余裕)。
    type SendOutcome =
      | { kind: "sent" }
      | { kind: "skipped"; reason: string }
      | { kind: "failed"; error: string };

    let outcome: SendOutcome;
    try {
      outcome = await prisma.$transaction(
        async (tx): Promise<SendOutcome> => {
          const locked = await tx.$queryRaw<{ status: string }[]>`
            SELECT status FROM "TaskInstance" WHERE id = ${r.instance.id} FOR UPDATE
          `;
          if (locked.length === 0 || locked[0].status !== "OPEN") {
            await tx.reminder.update({
              where: { id: r.id },
              data: {
                status: "SKIPPED",
                lastError: "task no longer OPEN",
                claimedAt: null,
              },
            });
            return { kind: "skipped", reason: "task no longer OPEN" };
          }

          const result = await deliver(r.channel, buildMessage(r.instance, r.escalationLevel));
          if (result.kind === "skipped") {
            await tx.reminder.update({
              where: { id: r.id },
              data: { status: "SKIPPED", lastError: result.reason, claimedAt: null },
            });
            return { kind: "skipped", reason: result.reason };
          }
          if (result.kind === "failed") {
            // 外側の catch で attempts++ / FAILED 判定する
            throw new Error(result.error);
          }
          await tx.reminder.update({
            where: { id: r.id },
            data: {
              status: "SENT",
              sentAt: new Date(),
              lastError: result.partialError,
              claimedAt: null,
            },
          });
          return { kind: "sent" };
        },
        {
          // 外部 HTTP を内包するので tx タイムアウトを 60s に拡大。
          // Slack webhook / Web Push は通常数百 ms。
          timeout: 60_000,
          maxWait: 5_000,
        },
      );
    } catch (e) {
      // tx 内で例外(外部送信失敗 or DB エラー)。
      // tx は自動 rollback 済み。Reminder は元の PENDING + claimedAt のまま
      // 残っているので、状態を別 tx で「失敗確定」に書き換える。
      // クラッシュなどで以下も走らなかった場合は STALE_CLAIM_MS 経過後の
      // pickup で再試行される(at-least-once)。
      await prisma.reminder
        .update({
          where: { id: r.id },
          data: {
            status: willBeFailed ? "FAILED" : "PENDING",
            attempts: nextAttempts,
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
            claimedAt: null,
          },
        })
        .catch(() => {
          /* DB がまだ死んでいる場合はあとで stale 拾い直し */
        });
      failed++;
      continue;
    }

    if (outcome.kind === "sent") sent++;
    else if (outcome.kind === "skipped") skipped++;
    else failed++;
  }

  if (missed.length > 0) {
    const res = await sendMissed(outage, missed, now);
    sent += res.sent;
    failed += res.failed;
    skipped += res.skipped;
  }

  const outageMin = outage ? Math.round((outage.to.getTime() - outage.from.getTime()) / 60_000) : 0;
  return { sent, failed, skipped, examined: pending.length, late: missed.length, outageMin };
}

/**
 * 大きく遅れたリマインダーの振り分け。
 *   文字列 → 送らない(理由)
 *   MissedItem → まとめ通知に入れる
 *   null → 通常どおり 1 件で送る(締切前の manaba チェック)
 */
async function classifyLate(
  r: {
    escalationLevel: number;
    instance: {
      id: number;
      title: string;
      dueAt: Date;
      itemType: "TASK" | "EVENT";
      status: string;
      sourceExternalId: string | null;
    };
  },
  now: Date,
  checkSubmission: (url: string) => Promise<string>,
): Promise<MissedItem | string | null> {
  const t = r.instance;
  if (t.status !== "OPEN") return "task no longer OPEN";
  const item = { instanceId: t.id, title: t.title, dueAt: t.dueAt };
  if (r.escalationLevel === MANABA_DEADLINE_LEVEL) {
    if (t.dueAt.getTime() > now.getTime()) return null;
    // 締切を過ぎてしまった。提出済みなら完了にして終わり、分からなければ確認を促す
    const url = manabaUrlOf(t.sourceExternalId);
    if (url && (await checkSubmission(url)) === "submitted") {
      await markManabaSubmitted(t.id);
      return "manaba で提出済み";
    }
    return { ...item, deadlinePassed: true };
  }
  // 終わってしまった予定を後から知らせても意味がない
  if (t.itemType === "EVENT" && t.dueAt.getTime() <= now.getTime()) return "止まっている間に予定の時刻を過ぎたため送信せず";
  return { ...item, deadlinePassed: false };
}

/** 遅れた分を 1 通にまとめて送り、対象のリマインダーをまとめて確定する。 */
async function sendMissed(
  outage: Outage | null,
  missed: { id: number; attempts: number; item: MissedItem }[],
  now: Date,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const ids = missed.map((m) => m.id);
  let result: Awaited<ReturnType<typeof deliver>>;
  try {
    result = await deliver("ALL", buildMissedMessage(outage, missed.map((m) => m.item), now));
  } catch (e) {
    result = { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  if (result.kind === "sent") {
    await prisma.reminder.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lastError: ("停止明けにまとめて送信" + (result.partialError ? ` / ${result.partialError}` : "")).slice(0, 500),
        claimedAt: null,
      },
    });
    return { sent: ids.length, failed: 0, skipped: 0 };
  }
  if (result.kind === "skipped") {
    await prisma.reminder.updateMany({
      where: { id: { in: ids } },
      data: { status: "SKIPPED", lastError: result.reason, claimedAt: null },
    });
    return { sent: 0, failed: 0, skipped: ids.length };
  }
  for (const m of missed) {
    const next = m.attempts + 1;
    await prisma.reminder
      .update({
        where: { id: m.id },
        data: {
          status: next >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
          attempts: next,
          lastError: result.error.slice(0, 500),
          claimedAt: null,
        },
      })
      .catch(() => undefined);
  }
  return { sent: 0, failed: ids.length, skipped: 0 };
}

/**
 * 締切直前チェックの事前判定。送らない場合はその理由を返す。
 *   - 締切を過ぎている(Mac のスリープ明け等で遅れて拾った) → 送らない
 *   - manaba で提出済み → タスクを DONE にして送らない
 *   - 未提出 / 確認できない → 送る(null)
 */
async function precheckManabaDeadline(
  r: { instance: { id: number; dueAt: Date; status: string; sourceExternalId: string | null } },
  checkSubmission: (url: string) => Promise<string>,
): Promise<string | null> {
  if (r.instance.status !== "OPEN") return "task no longer OPEN";
  if (r.instance.dueAt.getTime() <= Date.now()) return "締切を過ぎたため送信せず";
  const url = manabaUrlOf(r.instance.sourceExternalId);
  if (!url) return null;
  if ((await checkSubmission(url)) === "submitted") {
    await markManabaSubmitted(r.instance.id);
    return "manaba で提出済み";
  }
  return null;
}

type ReminderInstance = {
  id: number;
  title: string;
  dueAt: Date;
  itemType: "TASK" | "EVENT";
  required: boolean;
  priority: "HIGH" | "MID" | "LOW";
};

function buildMessage(instance: ReminderInstance, escalationLevel: number): NotifyMessage {
  const time = formatInTimeZone(instance.dueAt, APP_TZ, "M月d日 HH:mm", { locale: ja });
  if (escalationLevel === MANABA_DEADLINE_LEVEL) {
    const left = Math.max(0, Math.round((instance.dueAt.getTime() - Date.now()) / 60_000));
    return {
      title: `【未提出】締切まであと ${formatMinutes(left)}: ${instance.title}`.slice(0, 120),
      body: `締切 ${time}(manaba でまだ提出されていません)`,
      url: "/today",
      tag: `task-${instance.id}`,
    };
  }
  const tag =
    instance.itemType === "EVENT"
      ? "予定"
      : instance.required
        ? "必須タスク"
        : "任意タスク";
  const priorityLabel =
    instance.itemType === "EVENT"
      ? ""
      : instance.priority === "HIGH"
        ? " [優先 高]"
        : instance.priority === "LOW"
          ? " [優先 低]"
          : "";
  return {
    title: `${tag}${priorityLabel}: ${instance.title}`.slice(0, 120),
    body: time,
    url: "/today",
    tag: `task-${instance.id}`,
  };
}
