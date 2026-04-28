// manaba 課題一覧ページの HTML を取得して、テーブル構造を覗く。
// 実行: npx tsx scripts/dump-manaba-html.ts

import { config } from "dotenv";
import * as cheerio from "cheerio";
import { prisma } from "../src/lib/db";
import { decryptManabaPassword } from "../src/lib/manabaCrypto";
// scrape の private 関数を露出させたいので、直接 fetch + login を再現
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"; // 不要だが import grouping
void getDocument;

config();

const BASE = process.env.MANABA_BASE_URL ?? "https://cit.manaba.jp";
const UA = "Mozilla/5.0 (mochikata-debug)";

type Jar = Map<string, string>;
function jarH(j: Jar) {
  return [...j.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function ingest(j: Jar, h: Headers) {
  const list = (h as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const raw of list) {
    const semi = raw.indexOf(";");
    const pair = (semi === -1 ? raw : raw.slice(0, semi)).trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    j.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
async function fetch_(j: Jar, url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", UA);
  headers.set("Accept", "text/html");
  if (j.size > 0) headers.set("Cookie", jarH(j));
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  ingest(j, res.headers);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) return fetch_(j, new URL(loc, url).toString(), { method: "GET" });
  }
  return res;
}

(async () => {
  const cred = await prisma.manabaCredential.findFirst();
  if (!cred) { console.error("no cred"); process.exit(1); }
  const pw = decryptManabaPassword(cred.passwordEnc);

  const j: Jar = new Map();
  // login
  const lp = await fetch_(j, `${BASE}/ct/login`);
  const $$ = cheerio.load(await lp.text());
  const form = $$("form").first();
  const params = new URLSearchParams();
  $$("input[type='hidden']", form).each((_, el) => {
    const n = $$(el).attr("name");
    if (n) params.append(n, $$(el).attr("value") ?? "");
  });
  params.set("userid", cred.username);
  params.set("password", pw);
  if (!params.has("login")) params.set("login", "ログイン");
  await fetch_(j, `${BASE}/ct/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/ct/login` },
    body: params.toString(),
  });

  // fetch assignments
  const r = await fetch_(j, `${BASE}/ct/home_library_query`);
  const html = await r.text();
  const $ = cheerio.load(html);

  // ページ内のテーブルを列挙
  const tables = $("table").toArray();
  console.log(`tables: ${tables.length}`);
  tables.forEach((t, idx) => {
    const cls = $(t).attr("class") ?? "";
    const id = $(t).attr("id") ?? "";
    const tr = $(t).find("tr").length;
    console.log(`\n=== table[${idx}] class="${cls}" id="${id}" rows=${tr} ===`);
    const headers = $(t).find("th").map((_, th) => $(th).text().replace(/\s+/g, " ").trim()).get();
    if (headers.length) console.log(`  headers: ${headers.join(" | ")}`);
    const rows = $(t).find("tr").toArray().slice(0, 4);
    rows.forEach((tr, ri) => {
      const tds = $(tr).find("td").toArray().map((td) => {
        const text = $(td).text().replace(/\s+/g, " ").trim();
        const a = $(td).find("a").first();
        const href = a.attr("href") ?? "";
        const aText = a.text().replace(/\s+/g, " ").trim();
        return { text, href, aText };
      });
      if (tds.length === 0) return;
      console.log(`  row[${ri}]:`);
      tds.forEach((c, ci) => {
        console.log(`    td[${ci}] text="${c.text.slice(0, 80)}" link="${c.aText.slice(0, 60)}" href="${c.href.slice(0, 60)}"`);
      });
    });
  });
  await prisma.$disconnect();
})();
