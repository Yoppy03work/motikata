// 時間割エントリの個別更新・削除。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

// hex カラー(#RGB / #RRGGBB) または null(自動配色に戻す)。
const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "色は #RRGGBB 形式で指定")
  .optional()
  .nullable();

// UI は月-土 (1..6) のみ表示するので入力もそれに揃える。
// 以前 7(日曜)まで許容していたが、保存されると一覧から消える hidden 行になるため禁止。
const UpdateBody = z
  .object({
    dayOfWeek: z.number().int().min(1).max(6).optional(),
    period: z.number().int().min(1).max(10).optional(),
    endPeriod: z.number().int().min(1).max(10).optional(),
    startTime: HHmm.optional(),
    endTime: HHmm.optional(),
    courseName: z.string().min(1).max(120).optional(),
    classroom: z.string().max(60).optional().nullable(),
    teacher: z.string().max(60).optional().nullable(),
    color: HexColor,
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

  // 既存行を取って、partial update のときも (period, endPeriod) の整合性を
  // 保存後の値で再検証する。例えば現在 period=5/endPeriod=5 の行に
  // { endPeriod: 1 } だけ送られたら、保存後は period=5/endPeriod=1 で
  // 不整合になる。これを 400 で弾く。
  const existing = await prisma.classSchedule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const nextPeriod = parsed.data.period ?? existing.period;
  const nextEndPeriod = parsed.data.endPeriod ?? existing.endPeriod;
  if (nextEndPeriod < nextPeriod) {
    return NextResponse.json(
      {
        error: {
          fieldErrors: { endPeriod: ["終了限は開始限以上にしてください"] },
        },
      },
      { status: 400 },
    );
  }

  try {
    const item = await prisma.classSchedule.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json({ ok: true, item });
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
  try {
    await prisma.classSchedule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
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
