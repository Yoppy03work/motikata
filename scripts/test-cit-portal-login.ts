// citPortalScrape の login ステップを実機に対して動作確認するドライラン。
// Keycloak login フォームが取れる所まで進むかを見る(認証情報は不要)。
//
// 実行: npx tsx scripts/test-cit-portal-login.ts

import * as cheerio from "cheerio";

const PORTAL = "https://portal.chibatech.ac.jp";
const TIMETABLE = "/uprx/up/bs/bsa001/Bsa00101.xhtml";

type Jar = Map<string, Map<string, string>>;

function jarHeader(jar: Jar, host: string): string {
  const m = jar.get(host);
  if (!m || m.size === 0) return "";
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function ingest(jar: Jar, host: string, h: Headers): void {
  const list =
    typeof (h as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (h as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  let bucket = jar.get(host);
  if (!bucket) {
    bucket = new Map();
    jar.set(host, bucket);
  }
  for (const raw of list) {
    const semi = raw.indexOf(";");
    const pair = (semi === -1 ? raw : raw.slice(0, semi)).trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (!value) {
      bucket.delete(name);
      continue;
    }
    bucket.set(name, value);
  }
}

async function go(jar: Jar, url: string): Promise<{ html: string; finalUrl: string }> {
  let cur = url;
  for (let i = 0; i < 10; i++) {
    const u = new URL(cur);
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (cit-portal-debug)",
      Accept: "text/html,application/xhtml+xml",
    };
    const c = jarHeader(jar, u.host);
    if (c) headers.Cookie = c;
    const res = await fetch(cur, { headers, redirect: "manual" });
    ingest(jar, u.host, res.headers);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        return { html: await res.text(), finalUrl: cur };
      }
      cur = new URL(loc, cur).toString();
      continue;
    }
    return { html: await res.text(), finalUrl: cur };
  }
  throw new Error("too many redirects");
}

async function main() {
  const jar: Jar = new Map();
  console.log("[1] GET", PORTAL + TIMETABLE);
  const r1 = await go(jar, PORTAL + TIMETABLE);
  console.log("    finalUrl=", r1.finalUrl, "size=", r1.html.length);
  const $1 = cheerio.load(r1.html);
  const forms1 = $1("form")
    .map((_, el) => $1(el).attr("id"))
    .toArray();
  console.log("    forms=", forms1);
  let shibUrl: string | null = null;
  $1("a[href]").each((_, el) => {
    const href = $1(el).attr("href") || "";
    if (/ShibbolethAuthServlet/i.test(href)) {
      shibUrl = new URL(href, r1.finalUrl).toString();
      return false;
    }
  });
  console.log("    shibUrl=", shibUrl);
  if (!shibUrl) {
    console.log("!! no Shibboleth link found, dumping first 500 chars:");
    console.log(r1.html.slice(0, 500));
    return;
  }
  console.log("\n[2] GET", shibUrl);
  const r2 = await go(jar, shibUrl);
  console.log("    finalUrl=", r2.finalUrl, "size=", r2.html.length);
  const $2 = cheerio.load(r2.html);
  const forms2 = $2("form")
    .map((_, el) => $2(el).attr("id"))
    .toArray();
  console.log("    forms=", forms2);
  console.log("    has kc-form-login?", forms2.includes("kc-form-login"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
