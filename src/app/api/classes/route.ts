// 時間割マスター(ClassSchedule) の list / create。
// UI は /classes(曜日×時限グリッドの編集画面)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { classOverlapWhere } from "@/lib/classOverlap";
import { termRange } from "@/lib/fiscalYear";

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
    // 登録先の学年度・学期。effectiveFrom / effectiveTo はここから決める。
    term: z.object({
      year: z.number().int().min(2000).max(2100),
      semester: z.enum(["first", "second"]),
    }),
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

  // 同じ dayOfWeek 上で既存 ClassSchedule の period レンジと交差していないか
  // (有効期間が重ならない別学期・別年度の授業は対象外)。
  // TimetableClient のグリッドはセル単位 occupied 判定で後勝ち1件しか
  // 描画しないため、無検証で create を許すと DB は重複したまま UI から
  // どちらかが消える状態になる(Codex P2 3432475528 と同問題、POST 経路)。
  const {
    dayOfWeek,
    period,
    endPeriod,
    classroom,
    teacher,
    color,
    term,
    ...rest
  } = parsed.data;
  const { from: effectiveFrom, to: effectiveTo } = termRange(
    term.year,
    term.semester,
  );
  const overlap = await prisma.classSchedule.findFirst({
    where: classOverlapWhere({
      dayOfWeek,
      period,
      endPeriod,
      effectiveFrom,
      effectiveTo,
    }),
    select: {
      id: true,
      courseName: true,
      period: true,
      endPeriod: true,
    },
  });
  if (overlap) {
    const slot =
      overlap.period === overlap.endPeriod
        ? `${overlap.period}限`
        : `${overlap.period}-${overlap.endPeriod}限`;
    return NextResponse.json(
      {
        error: {
          fieldErrors: {
            period: [
              `${slot}は「${overlap.courseName}」と重なっています。別の枠を選ぶか、先にそちらを変更してください。`,
            ],
          },
        },
      },
      { status: 409 },
    );
  }

  const item = await prisma.classSchedule.create({
    data: {
      ...rest,
      dayOfWeek,
      period,
      endPeriod,
      classroom: classroom ?? null,
      teacher: teacher ?? null,
      color: color ?? null,
      effectiveFrom,
      effectiveTo,
    },
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
