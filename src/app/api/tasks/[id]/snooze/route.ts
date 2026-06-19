import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

const SNOOZE_MINUTES = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  // タスク存在チェック(削除済みのスヌーズは 404 を返す)
  const exists = await prisma.taskInstance.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 既存の未送信リマインダーをSKIPPED(後回しのため)。
      // dispatch が claim 中(claimedAt が新しい)の行は触らない。送信中の
      // PENDING を SKIPPED に書き換えると dispatch 側の CAS と衝突する。
      // 詳細は src/lib/dispatchReminders.ts のヘッダコメント参照。
      const staleClaim = new Date(Date.now() - 5 * 60_000);
      await tx.reminder.updateMany({
        where: {
          instanceId: id,
          status: "PENDING",
          OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
        },
        data: { status: "SKIPPED" },
      });

      // 直近のescalation_levelの最大+1で新しいリマインダーを追加
      const max = await tx.reminder.aggregate({
        where: { instanceId: id },
        _max: { escalationLevel: true },
      });
      const nextLevel = (max._max.escalationLevel ?? -1) + 1;
      const remindAt = new Date(Date.now() + SNOOZE_MINUTES * 60_000);
      const channel = "PUSH" as const;
      const dedupeKey = `${id}:${remindAt.toISOString()}:${channel}:${nextLevel}`;

      const reminder = await tx.reminder.create({
        data: {
          instanceId: id,
          remindAt,
          channel,
          escalationLevel: nextLevel,
          dedupeKey,
        },
      });
      return reminder;
    });
    return NextResponse.json({ reminder: result });
  } catch (e) {
    // findUnique 後・トランザクション中にタスクが削除されると Reminder.instanceId
    // の外部キー制約違反(P2003)になる。これは想定内の race condition なので
    // 500 ではなく recoverable な 404 を返す。
    // P2025 (record not found) も同様に 404 へマッピング。
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      (e.code === "P2003" || e.code === "P2025")
    ) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}
