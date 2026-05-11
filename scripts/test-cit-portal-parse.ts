// CITポータル時間割HTML パーサーのドライラン。
// tmp/timetable-sample.html を読んで CitPortalClass[] を出力する。
//
// 実行: npx tsx scripts/test-cit-portal-parse.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTimetableHtml } from "@/lib/citPortalScrape";

const samplePath = resolve(process.cwd(), "tmp/timetable-sample.html");
const html = readFileSync(samplePath, "utf8");
const classes = parseTimetableHtml(html);

console.log(`parsed ${classes.length} class entries\n`);

const dayLabels = ["", "月", "火", "水", "木", "金", "土"];
for (const c of classes) {
  const term =
    c.effectiveFrom &&
    c.effectiveFrom.toISOString().slice(5, 7) === "03"
      ? "前期"
      : c.effectiveFrom &&
          c.effectiveFrom.toISOString().slice(5, 7) === "09"
        ? "後期"
        : "?";
  const periodLabel =
    c.period === c.endPeriod
      ? `${c.period}限`
      : `${c.period}-${c.endPeriod}限`;
  console.log(
    `[${term}] ${dayLabels[c.dayOfWeek]} ${periodLabel} ${c.startTime}-${c.endTime}  ${c.courseName}`,
  );
  console.log(`         教員: ${c.teacher ?? "(なし)"}  教室: ${c.classroom ?? "(なし)"}`);
}
