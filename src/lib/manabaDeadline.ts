// manaba 課題の締切直前チェック。
//   - 締切 60 分前と 5 分前に Reminder(channel=ALL, escalationLevel=MANABA_DEADLINE_LEVEL)を置く
//   - dispatch 時に manaba の詳細ページで提出状況を確認し、
//       提出済み → タスクを DONE にして通知しない
//       未提出 / 確認できない → 通知する(取りこぼすより確認失敗でも知らせる方を優先)
//   - Reminder の作成・付け替えは manaba 同期のたびに行う(締切変更にも追従)

import { prisma } from "@/lib/db";
import { decryptManabaPassword } from "@/lib/manabaCrypto";
import {
  openManabaSession,
  parseSubmissionState,
  type ManabaSession,
  type ManabaSubmissionState,
} from "@/lib/manabaScrape";

// 0 = 通常, 1 = 朝の再通知(escalate)。2 を締切直前チェックに使う。
export const MANABA_DEADLINE_LEVEL = 2;
export const MANABA_DEADLINE_OFFSETS_MIN = [60, 5] as const;

const URL_KEY = /^manaba:url:(https?:\/\/.+)$/;

export function manabaUrlOf(sourceExternalId: string | null | undefined): string | null {
  return sourceExternalId?.match(URL_KEY)?.[1] ?? null;
}

export type PlannedReminder = { instanceId: number; remindAt: Date; dedupeKey: string };

// 締切に対して置くべき Reminder。過去になったものは置かない。
export function planDeadlineReminders(
  tasks: { id: number; dueAt: Date }[],
  now: Date,
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const t of tasks) {
    for (const off of MANABA_DEADLINE_OFFSETS_MIN) {
      const remindAt = new Date(t.dueAt.getTime() - off * 60_000);
      if (remindAt.getTime() <= now.getTime()) continue;
      out.push({
        instanceId: t.id,
        remindAt,
        dedupeKey: `manaba-due:${t.id}:${t.dueAt.toISOString()}:${off}`,
      });
    }
  }
  return out;
}

/** OPEN の manaba 課題について締切直前チェックの Reminder を揃える。 */
export async function syncManabaDeadlineReminders(
  now = new Date(),
): Promise<{ created: number; removed: number }> {
  const tasks = await prisma.taskInstance.findMany({
    where: {
      source: "ACADEMIC",
      status: "OPEN",
      sourceExternalId: { startsWith: "manaba:url:" },
      dueAt: { gt: now },
    },
    select: { id: true, dueAt: true },
  });
  const planned = planDeadlineReminders(tasks, now);
  const keep = planned.map((p) => p.dedupeKey);

  // 締切が変わった・タスクが閉じた等で不要になった未送信分を消す(送信処理中のものは触らない)
  const staleClaim = new Date(now.getTime() - 5 * 60_000);
  const removed = await prisma.reminder.deleteMany({
    where: {
      escalationLevel: MANABA_DEADLINE_LEVEL,
      status: "PENDING",
      dedupeKey: { notIn: keep },
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
    },
  });
  const created = await prisma.reminder.createMany({
    data: planned.map((p) => ({
      instanceId: p.instanceId,
      remindAt: p.remindAt,
      channel: "ALL" as const,
      escalationLevel: MANABA_DEADLINE_LEVEL,
      status: "PENDING" as const,
      dedupeKey: p.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return { created: created.count, removed: removed.count };
}

/**
 * 提出状況の確認関数を作る。ログインは最初に必要になった時の 1 回だけ。
 * ログインやページ取得に失敗したら "unknown" を返す。
 */
export function createSubmissionChecker(): (url: string) => Promise<ManabaSubmissionState> {
  let session: Promise<ManabaSession | null> | null = null;
  const open = async (): Promise<ManabaSession | null> => {
    const cred = await prisma.manabaCredential.findFirst();
    if (!cred) return null;
    return openManabaSession(cred.username, decryptManabaPassword(cred.passwordEnc));
  };
  return async (url) => {
    try {
      session ??= open().catch(() => null);
      const s = await session;
      if (!s) return "unknown";
      const res = await s.fetch(url);
      if (!res.ok) return "unknown";
      return parseSubmissionState(await res.text());
    } catch {
      return "unknown";
    }
  };
}

/** manaba で提出済みと分かったタスクを完了にし、残りの未送信リマインダーを止める。 */
export async function markManabaSubmitted(instanceId: number, now = new Date()): Promise<void> {
  await prisma.taskInstance.updateMany({
    where: { id: instanceId, status: "OPEN" },
    data: { status: "DONE", completedAt: now },
  });
  const staleClaim = new Date(now.getTime() - 5 * 60_000);
  await prisma.reminder.updateMany({
    where: {
      instanceId,
      status: "PENDING",
      OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
    },
    data: { status: "SKIPPED", lastError: "manaba で提出済み" },
  });
}
