// manaba パース動作確認スクリプト。
// 使い方: 環境変数で認証情報を渡して実行
//   MANABA_USER=... MANABA_PASS=... npx tsx scripts/test-manaba.ts

import { fetchManabaAssignments } from "../src/lib/manabaScrape";

(async () => {
  const u = process.env.MANABA_USER;
  const p = process.env.MANABA_PASS;
  if (!u || !p) {
    console.error("Set MANABA_USER and MANABA_PASS env vars");
    process.exit(1);
  }
  process.env.MANABA_DEBUG = "1";
  try {
    const list = await fetchManabaAssignments(u, p);
    console.log(`\nTotal: ${list.length}`);
    const now = Date.now();
    const future = list.filter((a) => a.dueAt && a.dueAt.getTime() > now);
    console.log(`Future: ${future.length}`);
    for (const a of future) {
      console.log(
        `  [future] ${a.dueAt?.toISOString()} ${a.course} / ${a.title}`,
      );
    }
  } catch (e) {
    console.error(e);
  }
})();
