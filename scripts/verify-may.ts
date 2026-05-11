// 実際にparseCitGakunenrekiを走らせて5月のイベントだけ抜き出す
// 実行: npx tsx scripts/verify-may.ts
import { parseCitGakunenreki } from "@/lib/parseCitGakunenreki";

async function main() {
  const r = await parseCitGakunenreki();
  const may = r.events.filter((e) => {
    const j = new Date(e.date.getTime() + 9 * 3600 * 1000);
    return j.getUTCFullYear() === 2026 && j.getUTCMonth() === 4;
  });
  console.log(`academicYear=${r.academicYear}, May events=${may.length}`);
  for (const e of may) {
    const j = new Date(e.date.getTime() + 9 * 3600 * 1000);
    console.log(`  ${j.toISOString().slice(0, 10)} [${e.kind}] ${e.title}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
