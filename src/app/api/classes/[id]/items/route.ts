// 授業ごとの持ち物テンプレート管理。
// ChecklistTemplate (ownerType=CLASS, ownerId=classId) を CRUD。
// PUT は「全置換」運用(送られたリストで上書き)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const PutBody = z.object({
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        orderIdx: z.number().int().min(0).optional(),
      }),
    )
    .max(100),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const classId = Number(idStr);
  if (!Number.isInteger(classId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const items = await prisma.checklistTemplate.findMany({
    where: { ownerType: "CLASS", ownerId: classId },
    orderBy: { orderIdx: "asc" },
  });
  return NextResponse.json({ ok: true, items });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const classId = Number(idStr);
  if (!Number.isInteger(classId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // 既存削除 → 新規一括 insert(transaction で原子的に)
  await prisma.$transaction([
    prisma.checklistTemplate.deleteMany({
      where: { ownerType: "CLASS", ownerId: classId },
    }),
    parsed.data.items.length > 0
      ? prisma.checklistTemplate.createMany({
          data: parsed.data.items.map((it, i) => ({
            ownerType: "CLASS",
            ownerId: classId,
            label: it.label.trim(),
            orderIdx: it.orderIdx ?? i,
          })),
        })
      : prisma.checklistTemplate.deleteMany({ where: { id: -1 } }), // no-op
  ]);
  return NextResponse.json({ ok: true, count: parsed.data.items.length });
}
