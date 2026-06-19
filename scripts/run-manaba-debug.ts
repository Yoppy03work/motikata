// DB に保存された manaba 認証情報を使って parser をデバッグ実行。
// 実行: npx tsx scripts/run-manaba-debug.ts

import { config } from "dotenv";
import { prisma } from "../src/lib/db";
import { decryptManabaPassword } from "../src/lib/manabaCrypto";
import { fetchManabaAssignments } from "../src/lib/manabaScrape";

config();
process.env.MANABA_DEBUG = "1";

(async () => {
  const cred = await prisma.manabaCredential.findFirst();
  if (!cred) {
    console.error("ManabaCredential が登録されていません");
    process.exit(1);
  }
  const pw = decryptManabaPassword(cred.passwordEnc);
  const list = await fetchManabaAssignments(cred.username, pw);
  console.log(`\nTotal: ${list.length}`);
  const now = Date.now();
  const future = list.filter((a) => a.dueAt && a.dueAt.getTime() > now);
  console.log(`Future: ${future.length}`);
  for (const a of future) {
    console.log(
      `  ${a.dueAt?.toISOString()} ${JSON.stringify(a.course)} / ${JSON.stringify(a.title)}`,
    );
  }
  await prisma.$disconnect();
})();
