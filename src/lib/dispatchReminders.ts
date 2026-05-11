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

export type DispatchSummary = {
  sent: number;
  failed: number;
  skipped: number;
  examined: number;
};

/** PENDING のリマインダーを attempts++ で原子的に占有する。
 *  並行な dispatcher 2 つが同時に同じ行に来た場合、両方の updateMany が
 *  `status=PENDING` だけを条件にすると count=1 / 1 になり二重送信される。
 *  そこで「前回読み取った attempts と一致する」条件を加え、Postgres の
 *  行ロックで先勝ち1件のみが count=1、後発は count=0 になるようにする。 */
async function tryClaim(
  reminderId: number,
  prevAttempts: number,
): Promise<boolean> {
  const res = await prisma.reminder.updateMany({
    where: {
      id: reminderId,
      status: "PENDING",
      attempts: prevAttempts,
    },
    data: { attempts: { increment: 1 } },
  });
  return res.count > 0;
}

export async function dispatchPendingReminders(): Promise<DispatchSummary> {
  const now = new Date();

  const pending = await prisma.reminder.findMany({
    where: {
      status: "PENDING",
      remindAt: { lte: now },
      attempts: { lt: MAX_ATTEMPTS },
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
    // 1) atomic claim (attempts++ with status=PENDING AND attempts=r.attempts 条件)
    const claimed = await tryClaim(r.id, r.attempts);
    if (!claimed) {
      // 既に他の dispatcher / 並行処理が拾った
      continue;
    }
    // claim 成功後の attempts 値(以後 update では idempotent)
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
          },
        });
        skipped++;
        continue;
      }

      try {
        await sendSlackMessage(buildSlackMessage(r.instance));
        await prisma.reminder.update({
          where: { id: r.id },
          data: { status: "SENT", sentAt: new Date(), lastError: null },
        });
        sent++;
      } catch (e) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: willBeFailed ? "FAILED" : "PENDING",
            lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500),
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
          data: { status: "SKIPPED", lastError: "VAPID 鍵が未設定です" },
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
            data: { status: "SKIPPED", lastError: "Push 購読者がいません" },
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
              lastError: `all push delivery failed (failed=${result.failed})`,
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
          },
        });
        sent++;
      } catch (e) {
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
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
