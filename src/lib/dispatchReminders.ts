// Reminder テーブルから「今送るべきもの」を引き、チャネル別に発射する。
// 設計:
// - 1 バッチ最大 BATCH_SIZE 件。worker が毎分叩くので大きい必要はない。
// - 失敗は attempts++、3回失敗で FAILED。
// - 紐づく TaskInstance が既に DONE/SKIPPED ならその Reminder は SKIPPED。
// - SLACK / PUSH 両チャネルを処理。
//
// 並行性:
//   - 送信前に atomic な「claim」(updateMany with status=PENDING)で attempts を
//     増やしてから送る。同じレコードを2つの dispatcher が同時に拾った場合、
//     後発側は updateMany.count===0 で送信スキップする。
//   - 送信直前に instance.status を再 fetch してチェック。dispatch 中にタスクが
//     完了/スキップされた場合の stale 通知を防ぐ。
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

    // 2) 送信直前に instance.status を再確認(stale 通知防止)
    const freshInstance = await prisma.taskInstance.findUnique({
      where: { id: r.instance.id },
      select: { status: true },
    });
    if (!freshInstance || freshInstance.status !== "OPEN") {
      await prisma.reminder.update({
        where: { id: r.id },
        data: {
          status: "SKIPPED",
          lastError: "task no longer OPEN",
          claimedAt: null,
        },
      });
      skipped++;
      continue;
    }

    // 3) チャネル別に送信
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
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            lastError: null,
            claimedAt: null,
          },
        });
        sent++;
      } catch (e) {
        // 実際の送信失敗時のみ attempts++(claim 時には増やしていない)
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
        await prisma.reminder.update({
          where: { id: r.id },
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
        sent++;
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
