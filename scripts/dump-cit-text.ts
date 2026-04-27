// PDF テキスト抽出 + セクション検出の生出力を確認するスクリプト。
// 実行: npx tsx scripts/dump-cit-text.ts

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const PDF_URL = "https://kmsk.is.it-chiba.ac.jp/portal/whole/gakubu/gakunenreki.pdf";
const PAGE_MONTHS: number[][] = [
  [4, 5, 6, 7, 8],
  [9, 10, 11, 12, 1, 2, 3],
];

(async () => {
  const res = await fetch(PDF_URL, { cache: "no-store" });
  const buf = new Uint8Array(await res.arrayBuffer());
  const doc = await getDocument({
    data: buf,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number };
    const items: Item[] = [];
    for (const it of content.items) {
      if (typeof (it as { str?: unknown }).str !== "string") continue;
      const t = it as { transform: number[]; str: string };
      items.push({ str: t.str, x: t.transform[4], y: t.transform[5] });
    }
    const rows = new Map<number, Item[]>();
    for (const it of items) {
      const yBucket = Math.round(it.y / 2) * 2;
      if (!rows.has(yBucket)) rows.set(yBucket, []);
      rows.get(yBucket)!.push(it);
    }
    const yKeys = [...rows.keys()].sort((a, b) => b - a);
    const lines = yKeys.map((y) =>
      rows.get(y)!.sort((a, b) => a.x - b.x).map((it) => it.str).join(" "),
    );

    const headerIdx: number[] = [];
    lines.forEach((l, i) => {
      const compact = l.replace(/[\s|]+/g, "");
      if (
        /日.*?月.*?火.*?水.*?木.*?金.*?土/.test(compact) &&
        compact.length >= 7 &&
        compact.length <= 30
      ) {
        headerIdx.push(i);
      }
    });

    const monthSeq = PAGE_MONTHS[p - 1] ?? [];
    console.log(`========== PAGE ${p} (months: ${monthSeq.join(",")}, headers: ${headerIdx.length}) ==========`);
    for (let i = 0; i < headerIdx.length; i++) {
      const start = headerIdx[i];
      const end = headerIdx[i + 1] ?? lines.length;
      const month = monthSeq[i] ?? "?";
      console.log(`---- section[${i}] = ${month}月 (lines ${start}..${end}) ----`);
      for (let li = start; li < end; li++) {
        const txt = lines[li];
        if (txt.trim()) console.log(`  ${JSON.stringify(txt)}`);
      }
    }
  }
})();
