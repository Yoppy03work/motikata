import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const inst = await tx.taskInstance.update({
        where: { id },
        data: { status: "DONE", completedAt: new Date() },
      });
      // 未送信のリマインダーをスキップ(発火停止)。
      // ただし dispatch が claim 中(claimedAt が新しい)の行は触らない。
      // dispatch は status=PENDING のまま外部送信を実行しており、ここで
      // SKIPPED に上書きすると、送信成功後の CAS(WHERE status=PENDING)が
      // 外れて Reminder 行の最終ステータスが定まらない or 二重で書かれる
      // 競合になる。dispatch 側が FOR UPDATE 経由で TaskInstance.status=
      // DONE を見て自分で SKIPPED に倒すので、ここでは委ねる。
      // STALE_CLAIM_MS (= 5 分) 以上前の claimedAt は dispatch がクラッシュ
      // して放置されたと見なして拾い直しの対象になっているので、ここでも
      // SKIPPED へ移してよい。同じ閾値を使う。
      const staleClaim = new Date(Date.now() - 5 * 60_000);
      await tx.reminder.updateMany({
        where: {
          instanceId: id,
          status: "PENDING",
          OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
        },
        data: { status: "SKIPPED" },
      });
      return inst;
    });
    return NextResponse.json({ instance: updated });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}
