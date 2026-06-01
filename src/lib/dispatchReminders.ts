// Reminder テーブルから「今送るべきもの」を引き、チャネル別に発射する。
// 設計:
// - 1 バッチ最大 BATCH_SIZE 件。worker が毎分叩くので大きい必要はない。
// - 失敗は attempts++、3回失敗で FAILED。
// - 紐づく TaskInstance が既に DONE/SKIPPED ならその Reminder は SKIPPED。
// - SLACK / PUSH 両チャネルを処理。
//
// 並行性:
//   - 送信前に atomic な「claim」(claimedAt セット)で同一行への並行 dispatch を防ぐ。
//     claim 時点では attempts は増やさず、送信成功/失敗時にのみ attempts++ する
//     設計にして、クラッシュやタイムアウトでリトライ枠を浪費しない。
//
//   - 完了競合の防止 (Codex P2 3333055217 / 3333105585):
//     旧旧版は「send 前に instance.status を読む」「send 後に Reminder を SENT に
//     書き込む」を別トランザクションで行っていて、completion が PENDING→SKIPPED
//     に書いた直後に dispatch が SKIPPED→SENT に上書きするレースが残っていた。
//     旧版(その対策)では tx 内で Reminder を pre-mark SENT に倒していたが、
//     pre-mark commit 直後に dispatch プロセスがクラッシュすると status=SENT が
//     永続化されてしまい、外部送信が一度も走っていないのに pickup query
//     (PENDING のみ)から漏れて永久に届かなくなる障害があった。
//
//     現在の方針:
//       1. dispatch は tryClaim で claimedAt をセットしただけの状態(status は
//          PENDING のまま)で次に進む。claimedAt は「送信中である」マーカー。
//       2. 送信前に TaskInstance 行を SELECT ... FOR UPDATE でロックして
//          status を再確認。OPEN でなければ Reminder を SKIPPED に倒して終了。
//       3. OPEN ならロックを解放して外部送信を実行。送信中に completion が
//          走っても、completion は claimedAt が新しい PENDING を保護対象
//          として除外する(後述の completion 側の WHERE 条件)。よって完了
//          後に dispatch が status=PENDING のままの行に対してのみ SENT を
//          書ける。完了が先に来ていれば、dispatch の FOR UPDATE 再確認で
//          DONE を見て SKIPPED に倒すパスに入る。
//       4. dispatch がクラッシュして claimedAt が残っても、status は
//          PENDING のままなので pickup query は STALE_CLAIM_MS 経過後に
//          再 pickup する。外部送信が一度も走っていなければ再送され、
//          通知が消える事故にならない(at-least-once)。送信済みだった
//          場合は二重配信になり得るが、稀かつ通知の二重通知は失通知より
//          ましという判断。
//
//     completion (/api/tasks/[id]/complete) 側の更新:
//       Reminder.status=PENDING を SKIPPED に倒す updateMany には
//       「claimedAt IS NULL OR claimedAt < stale」の AND を追加する。
//       これによって dispatch が claim 中(claimedAt 新しい)の行は
//       completion からは触らない。そのまま dispatch に処理を委ねる。
//
//   - Push が「購読者あり・全件配信失敗」のケースは SENT ではなく PENDING/FAILED
//     扱いにして再試行を許容する。

import { formatInTimeZone } from "date-fns-tz";
import { ja } from "date-fns/locale/ja";
import { prisma } from "@/lib/db";
import { isSlackEnabled, sendSlackMessage } from "@/lib/slack";
import { isPushConfigured, sendPushToAll } from "@/lib/push";
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
        },
      },
    },
    orderBy: { remindAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of pending) {
    // 1) atomic claim (claimedAt セット、attempts はまだ増やさない)
    const claimed = await tryClaim(r.id);
    if (!claimed) {
      // 既に他の dispatcher / 並行処理が拾った
      continue;
    }
    // 送信失敗時に attempts++ する。成功時は attempts は据え置きでも問題ない
    // (MAX_ATTEMPTS は失敗回数の上限という設計に揃える)。
    const nextAttempts = r.attempts + 1;
    const willBeFailed = nextAttempts >= MAX_ATTEMPTS;

    // 2) TaskInstance を FOR UPDATE ロックして status を再確認。
    //    completion (/api/tasks/[id]/complete) は TaskInstance.update を
    //    1番目にやるので同じ行ロックを取りに来る → ここで serialize される。
    //    completion が既に commit していれば status=DONE/SKIPPED が読めて、
    //    Reminder を SKIPPED にして終了。送信は走らない。
    //    OPEN ならロックを解放して送信に進む。tryClaim で claimedAt は既に
    //    新しい値が入っているので、send 中の completion はその Reminder を
    //    保護対象外として除外する(completion 側で claimedAt 条件を見る)。
    const proceed = await prisma.$transaction(async (tx) => {
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
        return false;
      }
      return true;
    });
    if (!proceed) {
      skipped++;
      continue;
    }

    // 3) チャネル別に送信(tx の外で実行。ロック保持時間を縮める)
    //    送信成功時は updateMany WHERE status=PENDING で「まだ PENDING な
    //    場合のみ SENT に倒す」CAS を実行。completion (rare) が間に
    //    入って SKIPPED に倒していたら count===0 となり上書きしない。
    //    送信失敗時は claimedAt をクリアし attempts++ で次回再試行を許す。
    //    クラッシュで途中で消えても status=PENDING のままなので
    //    pickup query が STALE_CLAIM_MS 経過後に拾い直して再送する。
    if (r.channel === "SLACK") {
      if (!isSlackEnabled()) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: "SKIPPED",
            lastError: "SLACK_WEBHOOK_URL not configured",
            claimedAt: null,
          },
        });
        skipped++;
        continue;
      }

      try {
        await sendSlackMessage(buildSlackMessage(r.instance));
        const upd = await prisma.reminder.updateMany({
          where: { id: r.id, status: "PENDING" },
          data: {
            status: "SENT",
            sentAt: new Date(),
            lastError: null,
            claimedAt: null,
          },
        });
        if (upd.count > 0) {
          sent++;
        } else {
          // completion が間に挟まって SKIPPED に倒した稀ケース。送信自体は
          // 既に外部に飛んでいるので「送れた」扱いにせず skipped 集計のみ。
          // status は completion 側の決定を尊重して触らない。
          skipped++;
        }
      } catch (e) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: willBeFailed ? "FAILED" : "PENDING",
            attempts: nextAttempts,
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
            claimedAt: null,
          },
        });
        failed++;
      }
      continue;
    }

    if (r.channel === "PUSH") {
      const ok = await isPushConfigured();
      if (!ok) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: "SKIPPED",
            lastError: "VAPID 鍵が未設定です",
            claimedAt: null,
          },
        });
        skipped++;
        continue;
      }
      try {
        const payload = buildPushPayload(r.instance);
        const result = await sendPushToAll(payload);
        if (result.total === 0) {
          // 購読者がいない: SKIPPED(無限リトライしない)
          await prisma.reminder.update({
            where: { id: r.id },
            data: {
              status: "SKIPPED",
              lastError: "Push 購読者がいません",
              claimedAt: null,
            },
          });
          skipped++;
          continue;
        }
        if (result.delivered === 0) {
          // 購読者はいるが 1件も配信成功してない → 失敗扱い
          // (一時的な VAPID/購読キー障害の可能性。MAX に達するまで retry)
          await prisma.reminder.update({
            where: { id: r.id },
            data: {
              status: willBeFailed ? "FAILED" : "PENDING",
              attempts: nextAttempts,
              lastError: `all push delivery failed (failed=${result.failed})`,
              claimedAt: null,
            },
          });
          failed++;
          continue;
        }
        const upd = await prisma.reminder.updateMany({
          where: { id: r.id, status: "PENDING" },
          data: {
            status: "SENT",
            sentAt: new Date(),
            lastError:
              result.failed > 0
                ? `partial: delivered=${result.delivered} failed=${result.failed}`
                : null,
            claimedAt: null,
          },
        });
        if (upd.count > 0) {
          sent++;
        } else {
          skipped++;
        }
      } catch (e) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            attempts: nextAttempts,
            claimedAt: null,
            status: willBeFailed ? "FAILED" : "PENDING",
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
          },
        });
        failed++;
      }
      continue;
    }
  }

  return { sent, failed, skipped, examined: pending.length };
}

function buildPushPayload(instance: ReminderInstance): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  const time = formatInTimeZone(instance.dueAt, APP_TZ, "M月d日 HH:mm");
  const tag =
    instance.itemType === "EVENT"
      ? "予定"
      : instance.required
        ? "必須タスク"
        : "任意タスク";
  return {
    title: `${tag}: ${instance.title}`.slice(0, 120),
    body: `${time}`,
    url: "/today",
    tag: `task-${instance.id}`,
  };
}

type ReminderInstance = {
  id: number;
  title: string;
  dueAt: Date;
  itemType: "TASK" | "EVENT";
  required: boolean;
  priority: "HIGH" | "MID" | "LOW";
};

function buildSlackMessage(instance: ReminderInstance): { text: string } {
  const time = formatInTimeZone(instance.dueAt, APP_TZ, "M月d日 HH:mm", { locale: ja });
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
        ? "[優先 高]"
        : instance.priority === "MID"
          ? ""
          : "[優先 低]";
  return {
    text: `[${tag}]${priorityLabel ? " " + priorityLabel : ""} ${instance.title}\n${time}`,
  };
}
