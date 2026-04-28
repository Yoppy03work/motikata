// 時間割マスター(ClassSchedule) の list / create。
// UI は /classes(曜日×時限グリッドの編集画面)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

// 手動入力 UI 用の最小入力。tagIds / checklist / reminders は別経路で。
// CIT は 1〜10 限の 1時間枠。連続 2〜4限が普通。
const CreateBody = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    period: z.number().int().min(1).max(10),
    endPeriod: z.number().int().min(1).max(10),
    startTime: HHmm,
    endTime: HHmm,
    courseName: z.string().min(1).max(120),
    classroom: z.string().max(60).optional().nullable(),
    teacher: z.string().max(60).optional().nullable(),
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
  const { classroom, teacher, ...rest } = parsed.data;
  const item = await prisma.classSchedule.create({
    data: {
      ...rest,
      classroom: classroom ?? null,
      teacher: teacher ?? null,
    },
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
