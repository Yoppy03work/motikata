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
  const all = await prisma.academicEvent.findMany({
    select: { date: true, importedFrom: true },
  });
  const byYear = new Map<number, number>();
  let citCount = 0;
  for (const e of all) {
    const y = academicYearOf(e.date);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
    if (e.importedFrom === "cit-gakunenreki") citCount++;
  }
  const yearsSorted = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, count]) => ({ academicYear: year, count }));

  const setting = await prisma.setting.findUnique({
    where: { key: SETTING_KEY_LAST_FETCH },
  });
  const lastCitFetch = setting?.value as CitLastFetch | null | undefined;

  return NextResponse.json({
    ok: true,
    total: all.length,
    citTotal: citCount,
    byYear: yearsSorted,
    lastCitFetch: lastCitFetch ?? null,
  });
}
