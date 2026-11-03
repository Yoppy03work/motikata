/**
 * 出席システム HTTP アダプタ
 *
 * ChibaTechPortal の attendance-http.ts を移植 (2026-11-02)。モチカタ用に例外クラス依存を外し、
 * 結果を判別可能な戻り値にした。creds は呼び出し側が復号して渡す (ここでは DB に触れない)。
 *
 * 実機確認で確定したフロー (CIT 内部網):
 *   ① POST /attendance/login  (_csrf+username+password、Referer/Origin 必須・keeplogin 送らない)
 *      → 302 /attendance/top。ヘッダ無し or keeplogin=on だと 200 再描画で無音失敗。
 *   ② GET  /attendance/class_room/{roomId} → 出席確認画面 (その教室の現授業)
 *   ③ POST /attendance/attend (_csrf のみ) → 「出席済みにしました」
 *
 * ホスト: attendance.is.it-chiba.ac.jp と attendance.is.chibatech.ac.jp は同一サーバ
 *   (10.64.40.1)。2026-11-02 時点で TLS 証明書は chibatech 側にのみ有効 (it-chiba は
 *   ERR_TLS_CERT_ALTNAME_INVALID で fetch 失敗) のため既定は chibatech。
 *
 * SECURITY: creds / QR / 出席システムの HTML 断片をログ・例外メッセージに出さない。
 */
import * as cheerio from "cheerio";

// WHY trim() || : compose の `${ATTENDANCE_BASE_URL:-}` は未設定時に空文字を渡す。
// `??` は空文字を既定に置き換えないため、空だと接続先が "" (相対URL) になり fetch が
// 失敗する。空白のみの値も含めて落として、必ず絶対URLの既定へフォールバックする。
const BASE_URL =
  process.env.ATTENDANCE_BASE_URL?.trim() || "https://attendance.is.chibatech.ac.jp";
const ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return BASE_URL;
  }
})();
const LOGIN_URL = `${BASE_URL}/attendance/login`;
const ATTEND_URL = `${BASE_URL}/attendance/attend`;
const classRoomUrl = (roomId: string) =>
  `${BASE_URL}/attendance/class_room/${encodeURIComponent(roomId)}`;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TIMEOUT_MS = 10000;

export type AttendanceOutcome =
  | "success"
  | "already"
  | "no-class"
  | "login-failed"
  | "error";

export interface AttendanceResult {
  success: boolean;
  outcome: AttendanceOutcome;
  message: string;
}

function extractCookies(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {};
  const setCookies = headers.getSetCookie?.() ?? [];
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    if (pair) {
      const eq = pair.indexOf("=");
      if (eq > 0) cookies[pair.substring(0, eq).trim()] = pair.substring(eq + 1).trim();
    }
  }
  return cookies;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** _csrf を取り出す。formActionContains 指定時はその action を持つフォーム内を優先。 */
function extractCsrf(html: string, formActionContains?: string): string | null {
  const $ = cheerio.load(html);
  if (formActionContains) {
    const $form = $("form")
      .filter((_, f) => ($(f).attr("action") || "").includes(formActionContains))
      .first();
    const scoped = $form.find('input[name="_csrf"]').attr("value");
    if (scoped) return scoped;
  }
  return $('input[name="_csrf"]').first().attr("value") ?? null;
}

/**
 * 出席システムのユーザ ID。
 * WHY: CIT ポータルは学籍番号の大文字・小文字を区別しないが、出席システムは区別し、
 * 先頭の英字を大文字で入れないと「ユーザIDまたはパスワードが違います」になる (2026-11-03 実機)。
 * 保存している学籍番号はポータル用の表記 (先頭が小文字) なので、出席のときだけ先頭を大文字にする。
 */
export function attendanceUserId(username: string): string {
  const u = username.trim();
  return u.charAt(0).toUpperCase() + u.slice(1);
}

export class AttendanceHttpAdapter {
  /** ログイン → class_room → attend のフルフローで出席する。 */
  async attend(
    username: string,
    password: string,
    roomId: string,
  ): Promise<AttendanceResult> {
    try {
      const cookies = await this.login(attendanceUserId(username), password);
      if (!cookies) {
        return { success: false, outcome: "login-failed", message: "ログインに失敗しました" };
      }
      return await this.attendInSession(cookies, roomId);
    } catch {
      // SECURITY: 例外の詳細 (URL/HTML 等) は握りつぶし、汎用メッセージのみ返す。
      return { success: false, outcome: "error", message: "出席処理中にエラーが発生しました" };
    }
  }

  /** 出席システム到達性チェック (HEAD)。外部アクセスが起きるので auto guard 通過後のみ呼ぶ。 */
  async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${BASE_URL}/attendance/`, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok || resp.status === 302;
    } catch {
      return false;
    }
  }

  /** ローカルフォームでログインしてセッション cookie を返す。失敗時 null。 */
  private async login(
    username: string,
    password: string,
  ): Promise<Record<string, string> | null> {
    let cookies: Record<string, string> = {};

    const getResp = await fetch(LOGIN_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    cookies = { ...cookies, ...extractCookies(getResp.headers) };
    const csrf = extractCsrf(await getResp.text());
    if (!csrf) return null;

    const postResp = await fetch(LOGIN_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        // WHY: Referer/Origin が無いと 200 でログイン画面に戻り無音失敗する。
        Origin: ORIGIN,
        Referer: LOGIN_URL,
        Cookie: cookieHeader(cookies),
      },
      // WHY: keeplogin は送らない (送ると検証時に認証が通らなかった)。
      body: new URLSearchParams({ _csrf: csrf, username, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    cookies = { ...cookies, ...extractCookies(postResp.headers) };

    const location = postResp.headers.get("location") || "";
    // 302 → /top が成功。200 再描画 or /login リダイレクトは認証失敗。
    if (postResp.status !== 302 || location.includes("/login")) return null;
    return cookies;
  }

  /** セッション cookie で class_room → /attendance/attend を実行する。 */
  private async attendInSession(
    cookies: Record<string, string>,
    roomId: string,
  ): Promise<AttendanceResult> {
    const crUrl = classRoomUrl(roomId);
    const cr = await fetch(crUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        Cookie: cookieHeader(cookies),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    Object.assign(cookies, extractCookies(cr.headers));
    const finalUrl = cr.url || crUrl;
    if (finalUrl.includes("/login")) {
      return { success: false, outcome: "login-failed", message: "セッションが無効です" };
    }
    const html = await cr.text();

    if (html.includes("出席済みにしました")) {
      return { success: true, outcome: "already", message: "出席済み" };
    }
    if (html.includes("出席できる授業はありません")) {
      return { success: false, outcome: "no-class", message: "現在、出席できる授業はありません" };
    }

    const hasAttendForm = /action="[^"]*\/attendance\/attend/.test(html);
    if (html.includes("出席で登録する") && hasAttendForm) {
      const csrf = extractCsrf(html, "/attendance/attend");
      if (!csrf) {
        return { success: false, outcome: "error", message: "出席フォームの取得に失敗しました" };
      }
      return await this.submitAttend(cookies, csrf, finalUrl);
    }

    return { success: false, outcome: "error", message: "出席状態を判定できませんでした" };
  }

  /** /attendance/attend に _csrf を POST して結果を判定する。 */
  private async submitAttend(
    cookies: Record<string, string>,
    csrf: string,
    referer: string,
  ): Promise<AttendanceResult> {
    const resp = await fetch(ATTEND_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
        Origin: ORIGIN,
        Referer: referer,
        Cookie: cookieHeader(cookies),
      },
      body: new URLSearchParams({ _csrf: csrf }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await resp.text();

    if (/出席済みにしました|出席を登録しました|出席しました/.test(html)) {
      return { success: true, outcome: "success", message: "出席完了" };
    }
    if (html.includes("出席できる授業はありません")) {
      return { success: false, outcome: "no-class", message: "現在、出席できる授業はありません" };
    }
    return { success: false, outcome: "error", message: "出席登録の結果を判定できませんでした" };
  }
}
