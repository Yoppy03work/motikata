import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const updated = await prisma.$transaction(async (tx) => {
    const inst = await tx.taskInstance.update({
      where: { id },
      data: { status: "DONE", completedAt: new Date() },
    });
    // 未送信のリマインダーをスキップ(発火停止)
    await tx.reminder.updateMany({
      where: { instanceId: id, status: "PENDING" },
      data: { status: "SKIPPED" },
    });
    return inst;
  });

  return NextResponse.json({ instance: updated });
}
