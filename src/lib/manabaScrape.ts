// manaba(千葉工大)から課題一覧をスクレイプして AcademicEvent もとい
// TaskInstance に流すための取得・パース層。
//
// 仕様:
//   - Cookie 付き fetch を手書き(tough-cookie 等を入れない最小実装)
//   - ログイン: POST {BASE}/ct/login_user に { login: usr_id, password: usr_pwd }
//     一般的な manaba(sky 株式会社製)のフォームにあたる前提
//   - 課題一覧: GET {BASE}/ct/mypage_published_report
//     行ごとに「コース名 / 課題タイトル / 提出期限」の table 構造を仮定
//     ※ HTML 構造はインスタンスにより微妙に違うため、要調整
//
// セキュリティ・運用上の注意:
//   - 生パスワードはこの関数の中でしか保持しない(呼び出し元は復号後すぐ渡す)
//   - エラー時は password 値を絶対にログに出さない
//   - manaba 側 HTML が変わるとパースが崩れる。fallback を用意
//
// 環境変数:
//   - MANABA_BASE_URL: 既定 "https://cm.it-chiba.ac.jp"

import * as cheerio from "cheerio";

export type ManabaAssignment = {
  course: string;
  title: string;
  dueAt: Date | null;
  url?: string | null;
};

export class ManabaError extends Error {
  constructor(
    message: string,
    public readonly stage: "login" | "fetch" | "parse" | "config",
  ) {
    super(message);
    this.name = "ManabaError";
  }
}

const DEFAULT_BASE = "https://cit.manaba.jp";
const UA =
  "Mozilla/5.0 (mochikata-reminder) Node fetch (Personal use)";

type CookieJar = Map<string, string>;

function jarHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function ingestSetCookie(jar: CookieJar, headers: Headers): void {
  // Headers#getSetCookie は Node 20 以降で利用可
  const list = (
    typeof (headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : []
  ) as string[];
  for (const raw of list) {
    const semi = raw.indexOf(";");
    const pair = (semi === -1 ? raw : raw.slice(0, semi)).trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (!value) {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
}

async function manabaFetch(
  jar: CookieJar,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", UA);
  headers.set("Accept", "text/html,application/xhtml+xml");
  if (jar.size > 0) headers.set("Cookie", jarHeader(jar));
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      redirect: "manual", // Set-Cookie を Cookie jar に取り込んでから手動でリダイレクト
    });
  } catch (e) {
    // fetch が throw する場合(DNS / TCP / TLS / 接続不可)は
    // 詳細を抽出してログ可能なエラーに変換する
    const cause = (e as { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`
        : cause
          ? String(cause)
          : "unknown";
    throw new ManabaError(
      `${e instanceof Error ? e.message : "fetch failed"} url=${url} cause=${causeMsg}`,
      "fetch",
    );
  }
  ingestSetCookie(jar, res.headers);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) {
      const next = new URL(loc, url).toString();
      return manabaFetch(jar, next, { method: "GET" });
    }
  }
  return res;
}

async function login(
  jar: CookieJar,
  base: string,
  username: string,
  password: string,
): Promise<void> {
  // CIT manaba: GET /ct/login でフォーム取得 → POST /ct/login で
  // userid + password + 隠しフィールド(SessionValue1, SessionValue, manaba-form)
  const loginUrl = `${base}/ct/login`;
  const getRes = await manabaFetch(jar, loginUrl);
  if (!getRes.ok) {
    throw new ManabaError(
      `ログインページ取得失敗 (HTTP ${getRes.status})`,
      "login",
    );
  }
  const $ = cheerio.load(await getRes.text());
  const form = $("form").first();
  if (form.length === 0) {
    throw new ManabaError("ログインフォームが見つかりません", "login");
  }
  const action = form.attr("action") || "login";
  const postUrl = new URL(action, loginUrl).toString();
  const params = new URLSearchParams();
  $("input[type='hidden']", form).each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") ?? "";
    if (name) params.append(name, value);
  });
  // CIT manaba のフィールド名は userid / password
  params.set("userid", username);
  params.set("password", password);
  // submit ボタンの name=login value=ログイン もブラウザが送るのでそれを再現
  // (manaba 内部でこの値の有無を確認している可能性)
  if (!params.has("login")) params.set("login", "ログイン");

  const baseOrigin = new URL(base).origin;
  const postRes = await manabaFetch(jar, postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: loginUrl,
      Origin: baseOrigin,
    },
    body: params.toString(),
  });

  if (!postRes.ok) {
    throw new ManabaError(
      `ログイン POST 失敗 (HTTP ${postRes.status})`,
      "login",
    );
  }
  const html = await postRes.text();
  // ログイン成功すると / (ホーム) へリダイレクトされ、レスポンスにログインフォームは無い
  // 失敗時は再度ログインフォームが表示される(name=password の input がある)
  const $$ = cheerio.load(html);
  const stillHasLoginForm = $$("input[type='password'][name='password']").length > 0;
  if (stillHasLoginForm) {
    // エラーメッセージを抽出してログ可能な文字列にする
    const errMsg = $$(".errorblock, .login-error, .alert").first().text().trim();
    throw new ManabaError(
      `ログイン失敗${errMsg ? `: ${errMsg.slice(0, 120)}` : ": ID/パスワードが違うか、フォーム構造が変わった可能性"}`,
      "login",
    );
  }
}

function parseDueDate(text: string): Date | null {
  // 想定パターン:
  //   "2026-04-25 23:59"
  //   "2026/04/25 23:59"
  //   "2026年4月25日 23:59"
  //   "4月25日 23:59" (年なし — 後述のロジックで現年/来年を推定)
  const t = text.trim();
  const m1 = t.match(
    /(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})日?\s*(\d{1,2})[:：](\d{2})/,
  );
  if (m1) {
    const [, y, m, d, hh, mm] = m1.map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh - 9, Number(mm)));
  }
  const m2 = t.match(/(\d{1,2})[-\/月](\d{1,2})日?\s*(\d{1,2})[:：](\d{2})/);
  if (m2) {
    const now = new Date();
    const [, mon, d, hh, mm] = m2.map(Number);
    // 年なしの日付: まず今年で解釈、過去になるなら翌年と推定。
    // 例: 4月時点で "1/15 23:59" は「今年の1月」(過去)ではなく「来年の1月」を意図。
    //     UI 表示や manaba 仕様で年を省略するケースを許容するための fallback。
    let y = now.getUTCFullYear();
    let candidate = new Date(Date.UTC(y, mon - 1, d, hh - 9, mm));
    if (candidate.getTime() < now.getTime()) {
      y += 1;
      candidate = new Date(Date.UTC(y, mon - 1, d, hh - 9, mm));
    }
    return candidate;
  }
  return null;
}

// CIT manaba(2026年4月確認)の課題一覧テーブル構造:
//   table.stdlist
//     <tr> ヘッダ: タイプ | タイトル | コース | 受付開始日時 | 受付終了日時 | 受付期間
//     <tr> 各課題: 同じ並び (td 6 列)
// タイプは "プロジェクト" / "アンケート" / "小テスト" / "レポート" / "ドリル" 等。
// ドリルはユーザ要望で除外する。
const SKIP_TYPES = new Set(["ドリル"]);

function parseAssignmentsHtml(html: string, base: string): ManabaAssignment[] {
  const $ = cheerio.load(html);
  const out: ManabaAssignment[] = [];

  $("table.stdlist tr").each((_, tr) => {
    const tds = $(tr).find("td").toArray();
    // ヘッダ行 (th のみ) や empty 行はスキップ
    if (tds.length < 5) return;

    const cellTexts = tds.map((td) => $(td).text().replace(/\s+/g, " ").trim());
    const type = cellTexts[0];
    const title = cellTexts[1];
    const course = cellTexts[2];
    // td[3] = 開始, td[4] = 終了(締切)
    const endStr = cellTexts[4];

    if (!title || !endStr) return;
    if (SKIP_TYPES.has(type)) return;

    const dueAt = parseDueDate(endStr);

    // タイトルセル内のリンクから href を取り出す(課題詳細ページの URL)
    const titleHref = $(tds[1]).find("a").first().attr("href");
    const url = titleHref ? new URL(titleHref, `${base}/ct/`).toString() : null;

    out.push({ course, title, dueAt, url });
  });

  if (process.env.MANABA_DEBUG === "1") {
    console.log(
      `[manaba] parsed ${out.length} assignments:\n` +
        out
          .map(
            (a, i) =>
              `  ${i + 1}. course="${a.course}" title="${a.title}" due=${a.dueAt?.toISOString() ?? "null"}`,
          )
          .join("\n"),
    );
  }

  return out;
}

// 課題一覧ページの候補 URL。manaba のバージョンによって path が変わるため、
// 順に試して 200 を返す最初のものを採用する。
// CIT manaba は /ct/home_library_query が実体(2026年4月確認)。
const ASSIGNMENT_URL_CANDIDATES = [
  "/ct/home_library_query",
  "/ct/home_summary_published_report",
  "/ct/home_published_report",
  "/ct/page_published_report",
  "/ct/home_summary",
  "/ct/mypage_published_report",
];

async function findAssignmentsUrl(jar: CookieJar, base: string): Promise<string> {
  // 既知の候補 URL を順に試行。最初に 200 を返したものを採用。
  for (const path of ASSIGNMENT_URL_CANDIDATES) {
    const url = `${base}${path}`;
    const res = await manabaFetch(jar, url);
    if (res.ok) return url;
  }
  // どれも当たらなければ /ct/home の HTML から動的にリンクを探す
  const homeRes = await manabaFetch(jar, `${base}/ct/home`);
  if (homeRes.ok) {
    const $ = cheerio.load(await homeRes.text());
    let bestHref: string | null = null;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text();
      if (
        (text.includes("課題") || /report|published|library|query/i.test(href)) &&
        !/discuss|news|grade|login|logout/i.test(href)
      ) {
        if (!bestHref) bestHref = href;
      }
    });
    if (bestHref) return new URL(bestHref, `${base}/ct/`).toString();
  }
  throw new ManabaError(
    `課題一覧 URL が特定できませんでした(候補すべて 404 / unreachable)`,
    "fetch",
  );
}

export async function fetchManabaAssignments(
  username: string,
  password: string,
): Promise<ManabaAssignment[]> {
  const base = (process.env.MANABA_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
  if (!username || !password) throw new ManabaError("認証情報が空です", "config");
  const jar: CookieJar = new Map();

  await login(jar, base, username, password);

  const fetchUrl = await findAssignmentsUrl(jar, base);
  const res = await manabaFetch(jar, fetchUrl);
  if (!res.ok) {
    throw new ManabaError(
      `課題一覧取得失敗 (HTTP ${res.status}) url=${fetchUrl}`,
      "fetch",
    );
  }
  const html = await res.text();
  const assignments = parseAssignmentsHtml(html, base);
  return assignments;
}
