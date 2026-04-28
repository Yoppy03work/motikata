// 時間割エントリの個別更新・削除。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

const UpdateBody = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7).optional(),
    period: z.number().int().min(1).max(10).optional(),
    endPeriod: z.number().int().min(1).max(10).optional(),
    startTime: HHmm.optional(),
    endTime: HHmm.optional(),
    courseName: z.string().min(1).max(120).optional(),
    classroom: z.string().max(60).optional().nullable(),
    teacher: z.string().max(60).optional().nullable(),
  })
  .refine(
    (v) => v.period === undefined || v.endPeriod === undefined || v.endPeriod >= v.period,
    {
      message: "終了限は開始限以上にしてください",
      path: ["endPeriod"],
    },
  );

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const item = await prisma.classSchedule.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await prisma.classSchedule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
