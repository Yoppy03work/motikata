import { NextResponse } from "next/server";
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

  const result = await prisma.$transaction(async (tx) => {
    // 既存の未送信リマインダーをSKIPPED(後回しのため)
    await tx.reminder.updateMany({
      where: { instanceId: id, status: "PENDING" },
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
}
