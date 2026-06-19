// 授業日計算ロジックの動作確認。
// 千葉工大 PDF をパース → computeClassDaysFromEvents → 結果を月ごとに集計表示。
// 実行: npx tsx scripts/test-class-days.ts

import { parseCitGakunenreki } from "../src/lib/parseCitGakunenreki";
import { computeClassDaysFromEvents } from "../src/lib/classDays";

function jstYmd(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

function jstDow(d: Date): number {
  return new Date(d.getTime() + 9 * 3600_000).getUTCDay();
}

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

(async () => {
  const { academicYear, events } = await parseCitGakunenreki();
  const classDays = computeClassDaysFromEvents(events);
  const set = new Set(classDays.map(jstYmd));

  console.log(`academicYear: ${academicYear}`);
  console.log(`computed class days: ${classDays.length}`);

  // 月ごとに集計
  const byMonth = new Map<string, { ymd: string; dow: number }[]>();
  for (const d of classDays) {
    const ym = jstYmd(d).slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push({ ymd: jstYmd(d), dow: jstDow(d) });
  }
  for (const [ym, days] of [...byMonth].sort()) {
    console.log(`\n${ym}: ${days.length} 日`);
    for (const d of days) {
      console.log(`  ${d.ymd} (${DOW[d.dow]})`);
    }
  }

  // 注目日を個別確認
  console.log(`\n--- 注目日 ---`);
  for (const target of [
    "2026-05-22",
    "2026-05-23",
    "2026-05-24",
    "2026-06-01",
    "2026-06-15",
    "2026-06-30",
    "2026-07-17",
    "2026-07-18",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
    "2026-11-23",
  ]) {
    const isClass = set.has(target);
    console.log(`  ${target}: ${isClass ? "授業日" : "非授業日"}`);
  }
})();
