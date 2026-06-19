// 千葉工大 学年歴 PDF パーサーの動作確認スクリプト。
// 実行: npx tsx scripts/test-cit-parse.ts

import { parseCitGakunenreki } from "../src/lib/parseCitGakunenreki";

(async () => {
  try {
    const r = await parseCitGakunenreki();
    console.log(`academicYear: ${r.academicYear}`);
    console.log(`events: ${r.events.length}`);
    for (const e of r.events) {
      const jst = e.date.toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      console.log(`  ${jst} [${e.kind.padEnd(7)}] ${e.title}`);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
