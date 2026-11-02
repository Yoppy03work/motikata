import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { parseId } from "@/lib/id";
import { MANABA_DEADLINE_LEVEL } from "@/lib/manabaDeadline";

const DEFAULT_SNOOZE_MINUTES = 60;

// 本文は省略可。{ minutes } で後回しにする分数を指定できる(ブラウザ通知の「30 分後」ボタン用)。
const Body = z.object({ minutes: z.number().int().min(5).max(24 * 60).optional() }).nullable();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const minutes = body.data?.minutes ?? DEFAULT_SNOOZE_MINUTES;

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
      // MANABA_DEADLINE_LEVEL は manaba の締切直前チェック専用(同期のたびに作り直される)なので、
      // 後回しのリマインダーはそれより上の番号にする
      const nextLevel = Math.max((max._max.escalationLevel ?? -1) + 1, MANABA_DEADLINE_LEVEL + 1);
      const remindAt = new Date(Date.now() + minutes * 60_000);
      const channel = "ALL" as const;
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
