// 学年歴の現在の登録状況を返す。設定画面のヘッダ表示用。
// - byYear: 学年度ごとの件数
// - lastCitFetch: 千葉工大 PDF を最後に取り込んだ時刻と件数(あれば)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { academicYearOf } from "@/lib/academicYear";
import {
  SETTING_KEY_LAST_FETCH,
  type CitLastFetch,
} from "@/lib/academicSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;

  // 学年度ごとに件数を数える(date を JS 側で academicYearOf に通す)
  const [all, classDays, setting] = await Promise.all([
    prisma.academicEvent.findMany({
      select: { date: true, importedFrom: true },
    }),
    prisma.classDay.findMany({ select: { date: true } }),
    prisma.setting.findUnique({ where: { key: SETTING_KEY_LAST_FETCH } }),
  ]);
  const byYear = new Map<number, { events: number; classDays: number }>();
  for (const e of all) {
    const y = academicYearOf(e.date);
    const v = byYear.get(y) ?? { events: 0, classDays: 0 };
    v.events += 1;
    byYear.set(y, v);
  }
  for (const c of classDays) {
    const y = academicYearOf(c.date);
    const v = byYear.get(y) ?? { events: 0, classDays: 0 };
    v.classDays += 1;
    byYear.set(y, v);
  }
  const yearsSorted = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, counts]) => ({
      academicYear: year,
      count: counts.events,
      classDayCount: counts.classDays,
    }));

  const lastCitFetch = setting?.value as CitLastFetch | null | undefined;

  return NextResponse.json({
    ok: true,
    total: all.length,
    classDayTotal: classDays.length,
    byYear: yearsSorted,
    lastCitFetch: lastCitFetch ?? null,
  });
}
