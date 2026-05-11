// 時間割マスター(ClassSchedule) の list / create。
// UI は /classes(曜日×時限グリッドの編集画面)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

// hex カラー(#RGB / #RRGGBB)。空/未指定は null として扱う。
const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "色は #RRGGBB 形式で指定")
  .optional()
  .nullable();

// 手動入力 UI 用の最小入力。tagIds / checklist / reminders は別経路で。
// CIT は 1〜10 限の 1時間枠。連続 2〜4限が普通。
// dayOfWeek は月-土 (1..6) のみ。UI が日曜を表示しないので、7 で保存すると
// 一覧から見えない hidden 行になるため禁止する。
const CreateBody = z
  .object({
    dayOfWeek: z.number().int().min(1).max(6),
    period: z.number().int().min(1).max(10),
    endPeriod: z.number().int().min(1).max(10),
    startTime: HHmm,
    endTime: HHmm,
    courseName: z.string().min(1).max(120),
    classroom: z.string().max(60).optional().nullable(),
    teacher: z.string().max(60).optional().nullable(),
    color: HexColor,
  })
  .refine((v) => v.endPeriod >= v.period, {
    message: "終了限は開始限以上にしてください",
    path: ["endPeriod"],
  });

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const items = await prisma.classSchedule.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { classroom, teacher, color, ...rest } = parsed.data;
  const item = await prisma.classSchedule.create({
    data: {
      ...rest,
      classroom: classroom ?? null,
      teacher: teacher ?? null,
      color: color ?? null,
    },
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
