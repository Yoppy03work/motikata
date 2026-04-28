// Reminder テーブルから「今送るべきもの」を引き、チャネル別に発射する。
// 設計:
// - 1 バッチ最大 BATCH_SIZE 件。worker が毎分叩くので大きい必要はない。
// - 失敗は attempts++、3回失敗で FAILED。
// - 紐づく TaskInstance が既に DONE/SKIPPED ならその Reminder は SKIPPED。
// - PUSH チャネルは未実装(別 dispatcher 担当)。本ファイルは SLACK のみ進める。

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
    // タスク本体が既に DONE/SKIPPED ならリマインダー不要
    if (r.instance.status !== "OPEN") {
      await prisma.reminder.update({
        where: { id: r.id },
        data: { status: "SKIPPED" },
      });
      skipped++;
      continue;
    }

    if (r.channel === "SLACK") {
      if (!isSlackEnabled()) {
        // 未設定: SKIPPED にして無限再試行を避ける
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
          data: {
            status: "SENT",
            sentAt: new Date(),
            attempts: r.attempts + 1,
            lastError: null,
          },
        });
        sent++;
      } catch (e) {
        const nextAttempts = r.attempts + 1;
        const failedNow = nextAttempts >= MAX_ATTEMPTS;
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: failedNow ? "FAILED" : "PENDING",
            attempts: nextAttempts,
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
          data: {
            status: "SKIPPED",
            lastError: "VAPID 鍵が未設定です",
          },
        });
        skipped++;
        continue;
      }
      try {
        const payload = buildPushPayload(r.instance);
        const result = await sendPushToAll(payload);
        if (result.total === 0) {
          // 購読者がいないので SKIPPED 扱いにして retry しない
          await prisma.reminder.update({
            where: { id: r.id },
            data: {
              status: "SKIPPED",
              lastError: "Push 購読者がいません",
            },
          });
          skipped++;
          continue;
        }
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            attempts: r.attempts + 1,
            lastError:
              result.failed > 0
                ? `partial: delivered=${result.delivered} failed=${result.failed}`
                : null,
          },
        });
        sent++;
      } catch (e) {
        const nextAttempts = r.attempts + 1;
        const failedNow = nextAttempts >= MAX_ATTEMPTS;
        await prisma.reminder.update({
          where: { id: r.id },
          data: {
            status: failedNow ? "FAILED" : "PENDING",
            attempts: nextAttempts,
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
    body: `⏰ ${time}`,
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
      ? "📅 予定"
      : instance.required
        ? "✅ 必須タスク"
        : "◎ 任意タスク";
  const priorityIcon =
    instance.priority === "HIGH" ? "🔴" : instance.priority === "MID" ? "🟡" : "⚪";
  return {
    text: `${tag} ${priorityIcon} ${instance.title}\n⏰ ${time}`,
  };
}
