// CITポータル(Universal Passport RX)から時間割をスクレイプする層。
//
// 認証フロー:
//   1. GET https://portal.chibatech.ac.jp/uprx/up/bs/bsa001/Bsa00101.xhtml
//      → 未認証なら 302 で Keycloak (SAML IdP) に飛ぶ
//   2. SAMLRequest 付き URL を follow
//      → Keycloak の login form (id="kc-form-login") が表示される
//   3. POST username + password (action は form.action そのまま)
//      → Keycloak の OTP form (id="kc-otp-login-form") が返る
//   4. otp + selectedCredentialId を POST
//      → SAML auto-submit form (action= portal.../uprx/ShibbolethAuthServlet) が返る
//   5. SAMLResponse + RelayState を SP に POST
//      → 302 で portal の元ページ or ホーム (Pkx00701.xhtml) に戻る
//   6. 必要に応じて時間割ページ (Bsa00101.xhtml) を GET
//      → JSF/PrimeFaces のテーブルから時間割を抽出
//
// 環境変数:
//   - CIT_PORTAL_BASE_URL: ポータル基準URL (既定 "https://portal.chibatech.ac.jp")
//   - CIT_PORTAL_DEBUG=1: 各ステップ後の HTML サイズと検出フォームをログ出力

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { TOTP } from "otpauth";

export type CitPortalClass = {
  // 月=1, 火=2, 水=3, 木=4, 金=5, 土=6
  dayOfWeek: number;
  // 開始限・終了限 (1-10)。連続コマは 2-4 等のレンジになる
  period: number;
  endPeriod: number;
  // 表示開始/終了時刻 ("HH:MM" 形式)
  startTime: string;
  endTime: string;
  courseName: string;
  classroom: string | null;
  teacher: string | null;
  // 学期境界(前期/後期)。manualで上書き可能だが、cron同期では毎回上書きされる。
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

export class CitPortalError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "config"
      | "login"
      | "mfa"
      | "fetch"
      | "parse"
      | "session",
  ) {
    super(message);
    this.name = "CitPortalError";
  }
}

const DEFAULT_BASE = "https://portal.chibatech.ac.jp";
const TIMETABLE_PATH = "/uprx/up/bs/bsa001/Bsa00101.xhtml";
const UA = "Mozilla/5.0 (mochikata-reminder) Node fetch (Personal use)";
const DEBUG = process.env.CIT_PORTAL_DEBUG === "1";

// ─────────────────────────────────────────
// Multi-host cookie jar
// 1リクエスト1ホストではなく、複数ドメイン(portal/sso)を跨ぐので
// ホスト別に Cookie を保持する。Domain 属性は無視して response host に紐付け。
// ─────────────────────────────────────────
type HostCookieJar = Map<string, Map<string, string>>;

function getCookieHeader(jar: HostCookieJar, host: string): string {
  const cookies = jar.get(host);
  if (!cookies || cookies.size === 0) return "";
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function ingestSetCookie(
  jar: HostCookieJar,
  host: string,
  headers: Headers,
): void {
  const list = (
    typeof (headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : []
  ) as string[];
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

/**
 * 手動リダイレクト方式の fetch。
 * 各リダイレクトでクッキーを取り込み、host単位で送り直す。
 * 302/303 の Location は新しいGETに、307/308 は元のメソッド維持で follow。
 */
async function portalFetch(
  jar: HostCookieJar,
  url: string,
  init: RequestInit | undefined,
  maxRedirects = 12,
): Promise<{ res: Response; finalUrl: string }> {
  let currentUrl = url;
  let currentInit: RequestInit = { ...(init ?? {}) };

  for (let i = 0; i < maxRedirects; i++) {
    const u = new URL(currentUrl);
    const headers = new Headers(currentInit.headers);
    headers.set("User-Agent", UA);
    if (!headers.has("Accept")) {
      headers.set(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      );
    }
    headers.set("Accept-Language", "ja,en;q=0.5");
    const cookieHeader = getCookieHeader(jar, u.host);
    if (cookieHeader) headers.set("Cookie", cookieHeader);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        ...currentInit,
        headers,
        redirect: "manual",
      });
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      const causeMsg =
        cause instanceof Error
          ? `${cause.name}: ${cause.message}`
          : cause
            ? String(cause)
            : "unknown";
      throw new CitPortalError(
        `${e instanceof Error ? e.message : "fetch failed"} url=${currentUrl} cause=${causeMsg}`,
        "fetch",
      );
    }

    ingestSetCookie(jar, u.host, res.headers);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: currentUrl };
      const next = new URL(loc, currentUrl).toString();
      // 302 / 303: GET にダウングレード(RFC 7231)
      // 307 / 308: メソッド・ボディ維持
      if (res.status === 307 || res.status === 308) {
        currentInit = { ...currentInit, headers: undefined };
      } else {
        currentInit = { method: "GET" };
      }
      currentUrl = next;
      continue;
    }

    return { res, finalUrl: currentUrl };
  }
  throw new CitPortalError(`too many redirects starting at ${url}`, "fetch");
}

// ─────────────────────────────────────────
// Form 抽出ヘルパ
// ─────────────────────────────────────────
type ParsedForm = {
  action: string;
  method: string;
  fields: Record<string, string>;
};

function parseFormById(
  html: string,
  baseUrl: string,
  id: string,
): ParsedForm | null {
  const $ = cheerio.load(html);
  const $form = $(`form#${id}`).first();
  if ($form.length === 0) return null;
  return parseFormElement($, $form, baseUrl);
}

function parseFirstPostForm(html: string, baseUrl: string): ParsedForm | null {
  const $ = cheerio.load(html);
  const $form = $('form[method="post"], form[method="POST"]').first();
  if ($form.length === 0) return null;
  return parseFormElement($, $form, baseUrl);
}

function parseFormElement(
  $: cheerio.CheerioAPI,
  $form: cheerio.Cheerio<AnyNode>,
  baseUrl: string,
): ParsedForm {
  const actionAttr = ($form.attr("action") || "").trim();
  // attr() は HTML エンティティをデコードして返す
  const action = actionAttr ? new URL(actionAttr, baseUrl).toString() : baseUrl;
  const method = ($form.attr("method") || "GET").toUpperCase();
  const fields: Record<string, string> = {};
  $form.find("input").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") || "text").toLowerCase();
    const name = $el.attr("name");
    if (!name) return;
    if (type === "submit" || type === "button" || type === "reset") return;
    if (type === "checkbox" || type === "radio") {
      if ($el.attr("checked") !== undefined) {
        fields[name] = $el.attr("value") ?? "on";
      }
      return;
    }
    fields[name] = $el.attr("value") ?? "";
  });
  $form.find("textarea").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name) return;
    fields[name] = $el.text();
  });
  $form.find("select").each((_, el) => {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name) return;
    const $sel = $el.find("option[selected]").first();
    fields[name] =
      $sel.length > 0
        ? ($sel.attr("value") ?? $sel.text())
        : ($el.find("option").first().attr("value") ?? "");
  });
  return { action, method, fields };
}

function debugLog(label: string, html: string): void {
  if (!DEBUG) return;
  const formIds = [...html.matchAll(/<form[^>]*\sid="([^"]+)"/g)].map(
    (m) => m[1],
  );
  const hasSamlResponse = /name="SAMLResponse"/.test(html);
  console.log(
    `[cit-portal][${label}] size=${html.length} forms=[${formIds.join(",")}] saml=${hasSamlResponse}`,
  );
}

// ─────────────────────────────────────────
// SSO + MFA ログイン
// ─────────────────────────────────────────
async function login(
  jar: HostCookieJar,
  baseUrl: string,
  username: string,
  password: string,
  totpSecret: string,
  totpDeviceName: string | null,
): Promise<string> {
  // 1. 時間割ページを叩く。未認証なら UPRX のログイン選択ページに着地する
  //    (ここから Shibboleth リンクを経由して Keycloak へ飛ぶ追加ステップが必要)
  const initial = await portalFetch(
    jar,
    `${baseUrl}${TIMETABLE_PATH}`,
    undefined,
  );
  if (!initial.res.ok) {
    throw new CitPortalError(
      `初期ページ取得失敗 (HTTP ${initial.res.status}) finalUrl=${initial.finalUrl}`,
      "fetch",
    );
  }
  let html = await initial.res.text();
  let lastUrl = initial.finalUrl;
  debugLog("after initial", html);

  // 既に認証済みでそのまま時間割が返ってきたケース
  if (
    html.includes("classTable") ||
    (html.includes("Pkx00701") && !html.includes("kc-form-login")) ||
    html.includes("rx-token")
  ) {
    return html;
  }

  // 2. UPRX ログイン選択ページに着地した場合は、統合認証(Shibboleth)リンクを踏む。
  //    典型パターン: <a href="https://portal.chibatech.ac.jp/uprx/ShibbolethAuthServlet"
  //    ...>在学生・教職員専用ログイン（統合認証）</a>
  if (!parseFormById(html, lastUrl, "kc-form-login")) {
    const $ = cheerio.load(html);
    let shibUrl: string | null = null;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (/ShibbolethAuthServlet/i.test(href)) {
        shibUrl = new URL(href, lastUrl).toString();
        return false;
      }
    });
    if (shibUrl) {
      const r = await portalFetch(jar, shibUrl, undefined);
      if (!r.res.ok) {
        throw new CitPortalError(
          `Shibboleth開始失敗 (HTTP ${r.res.status}) url=${shibUrl}`,
          "login",
        );
      }
      html = await r.res.text();
      lastUrl = r.finalUrl;
      debugLog("after Shibboleth start", html);
    }
  }

  // 3. Keycloak ログインフォーム解析
  const loginForm = parseFormById(html, lastUrl, "kc-form-login");
  if (!loginForm) {
    throw new CitPortalError(
      "Keycloakログインフォームが見つかりません(IdPの仕様変更?)",
      "login",
    );
  }

  // 4. ID/パスワード POST
  const credBody = new URLSearchParams();
  credBody.set("username", username);
  credBody.set("password", password);
  credBody.set("credentialId", loginForm.fields.credentialId ?? "");
  credBody.set("login", "Sign In");
  // rememberMe は未チェック扱い(送らない)
  let resp = await portalFetch(jar, loginForm.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(loginForm.action).origin,
      Referer: lastUrl,
    },
    body: credBody.toString(),
  });
  if (!resp.res.ok) {
    throw new CitPortalError(
      `ログインPOST失敗 (HTTP ${resp.res.status})`,
      "login",
    );
  }
  html = await resp.res.text();
  lastUrl = resp.finalUrl;
  debugLog("after credentials POST", html);

  // ID/パスワード誤りなら login form が再び表示される
  if (parseFormById(html, lastUrl, "kc-form-login")) {
    // エラーメッセージ抽出を試みる
    const $err = cheerio.load(html);
    const errMsg = $err(
      ".alert-error, .pf-v5-c-alert__title, .pf-c-alert__title, [data-testid='login-error'], #input-error-username, #input-error-password",
    )
      .first()
      .text()
      .trim();
    throw new CitPortalError(
      `ログイン失敗: ID/パスワードが違う可能性${errMsg ? ` [${errMsg.slice(0, 120)}]` : ""}`,
      "login",
    );
  }

  // 4.5. クレデンシャル選択画面が出ていればここで選択POST。
  //      Keycloak は MFA手段が複数登録されてると "select-credential" 画面を挟む。
  //      ラジオの name="authenticationExecution"、value=各クレデンシャルのID。
  //      ラベルテキストに totpDeviceName が含まれるものを優先選択。
  const selectForm = parseFormById(html, lastUrl, "kc-select-credential-form");
  if (selectForm) {
    const $sel = cheerio.load(html);
    type Option = { id: string; label: string };
    const options: Option[] = [];
    $sel("input[name='authenticationExecution']").each((_, el) => {
      const id = $sel(el).attr("value") || "";
      if (!id) return;
      const inputId = $sel(el).attr("id") || "";
      const label = inputId
        ? $sel(`label[for="${inputId}"]`).first().text().trim()
        : "";
      options.push({ id, label });
    });
    if (options.length === 0) {
      // ラジオが見つからない場合、button[name='authenticationExecution'] パターンを試す
      $sel("button[name='authenticationExecution']").each((_, el) => {
        const id = $sel(el).attr("value") || "";
        if (!id) return;
        const label = $sel(el).text().trim();
        options.push({ id, label });
      });
    }
    if (options.length === 0) {
      throw new CitPortalError(
        "クレデンシャル選択画面が表示されたが、選択肢が抽出できなかった",
        "mfa",
      );
    }
    let chosen: Option | undefined;
    if (totpDeviceName) {
      const needle = totpDeviceName.toLowerCase();
      chosen = options.find((o) => o.label.toLowerCase().includes(needle));
    }
    if (!chosen) chosen = options[0];
    if (DEBUG) {
      console.log(
        `[cit-portal][select-credential] options=${options.map((o) => `${o.label}#${o.id.slice(0, 6)}`).join(", ")} chosen=${chosen.label}`,
      );
    }
    const selBody = new URLSearchParams();
    // 元フォームの hidden inputs を引き継ぐ(authexec-hidden-input 等)
    for (const [k, v] of Object.entries(selectForm.fields)) {
      if (k === "authenticationExecution") continue;
      selBody.set(k, v);
    }
    selBody.set("authenticationExecution", chosen.id);
    selBody.set("login", "Sign In");
    const r = await portalFetch(jar, selectForm.action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: new URL(selectForm.action).origin,
        Referer: lastUrl,
      },
      body: selBody.toString(),
    });
    if (!r.res.ok) {
      throw new CitPortalError(
        `クレデンシャル選択POST失敗 (HTTP ${r.res.status})`,
        "mfa",
      );
    }
    html = await r.res.text();
    lastUrl = r.finalUrl;
    debugLog("after credential pick", html);
  }

  // 5. OTP フォーム解析
  const otpForm = parseFormById(html, lastUrl, "kc-otp-login-form");
  if (!otpForm) {
    throw new CitPortalError(
      "OTP入力フォームが見つかりません(MFAがTOTPでない可能性: パスキーや別のAuthenticatorに切り替わってる?)",
      "mfa",
    );
  }

  // 6. TOTP コード生成 + POST
  let otpCode: string;
  try {
    otpCode = generateTotpCode(totpSecret);
  } catch (e) {
    throw new CitPortalError(
      `TOTP生成失敗: ${e instanceof Error ? e.message : String(e)}`,
      "config",
    );
  }

  // OTPフォーム内に複数のTOTPデバイスが切替UIで埋まっているケース。
  // hidden の selectedCredentialId はデフォルト(=先頭デバイス)の UUID を持つ。
  // クリック切替で値を書き換える JS が走るが、サーバーから来た時点では
  // デフォルトのままなので、こちらでデバイス名マッチで上書きする。
  let chosenCredId: string | null =
    otpForm.fields.selectedCredentialId || null;
  if (totpDeviceName) {
    const $otp = cheerio.load(html);
    type Opt = { id: string; label: string };
    const opts: Opt[] = [];
    // パターンA: <input type="radio" name="selectedCredentialId" value="<id>"> + 紐づく label
    $otp("input[name='selectedCredentialId']").each((_, el) => {
      const $el = $otp(el);
      const type = ($el.attr("type") || "").toLowerCase();
      const value = $el.attr("value") || "";
      if (!value) return;
      if (type !== "radio" && type !== "hidden") return;
      const inputId = $el.attr("id") || "";
      const label = inputId
        ? $otp(`label[for="${inputId}"]`).first().text().trim()
        : "";
      opts.push({ id: value, label });
    });
    // パターンB: data-credentialid 属性を持つボタンやリンク
    $otp("[data-credentialid]").each((_, el) => {
      const $el = $otp(el);
      const value = $el.attr("data-credentialid") || "";
      if (!value) return;
      const label = $el.text().trim() || $el.attr("aria-label") || "";
      if (!opts.some((o) => o.id === value)) opts.push({ id: value, label });
    });
    // パターンC: PatternFly tile の onclick="toggleOTP(N, 'UUID')" から抽出。
    // タイトルは <span class="pf-v5-c-tile__title"> に入る。
    // (CITポータル/Keycloak26 で実際に使われていた構造)
    $otp(
      'div[onclick^="toggleOTP"], div[id^="kc-otp-credential-"], .pf-v5-c-tile[onclick]',
    ).each((_, el) => {
      const $el = $otp(el);
      const onclick = $el.attr("onclick") || "";
      const m = onclick.match(
        /toggleOTP\(\s*\d+\s*,\s*['"]([^'"]+)['"]\s*\)/,
      );
      if (!m) return;
      const id = m[1];
      const titleSpan = $el
        .find("span.pf-v5-c-tile__title, .pf-v5-c-tile__title")
        .first()
        .text()
        .trim();
      const label = titleSpan || $el.text().replace(/\s+/g, " ").trim();
      if (!opts.some((o) => o.id === id)) opts.push({ id, label });
    });
    const needle = totpDeviceName.toLowerCase();
    const matched = opts.find((o) =>
      o.label.toLowerCase().includes(needle),
    );
    if (matched) {
      chosenCredId = matched.id;
    }
    if (DEBUG) {
      console.log(
        `[cit-portal][otp-credentials] options=${opts.length === 0 ? "(none)" : opts.map((o) => `"${o.label}"#${o.id.slice(0, 8)}`).join(", ")} matched=${matched ? matched.label : "(none, using default)"}`,
      );
      // マッチできなかった/オプションが少なすぎる場合は、OTPフォーム周辺の HTMLを
      // 8KB分ダンプして構造を確認する(機微情報を含まない前提、本番ではDEBUG=0)
      if (!matched) {
        const $otp2 = cheerio.load(html);
        const $form = $otp2("form#kc-otp-login-form");
        const formHtml = $otp2.html($form) || "";
        const parentHtml = $otp2.html($form.parent()) || "";
        // フォーム自身ではなく親(=同じカード/コンテナ)の生HTMLが欲しい
        // pc(motica)/スマホ といった文字列の周辺を見たい
        console.log(
          `[cit-portal][otp-credentials] form HTML (first 4KB):\n${formHtml.slice(0, 4000)}`,
        );
        console.log(
          `[cit-portal][otp-credentials] parent HTML (first 4KB):\n${parentHtml.slice(0, 4000)}`,
        );
      }
    }
  }

  const otpBody = new URLSearchParams();
  if (chosenCredId) otpBody.set("selectedCredentialId", chosenCredId);
  otpBody.set("otp", otpCode);
  otpBody.set("login", "Sign In");
  if (DEBUG) {
    // OTPは出さない。selectedCredentialIdとactionだけ。
    console.log(
      `[cit-portal][otp-post] credId=${chosenCredId?.slice(0, 8) ?? "(none)"} action=${otpForm.action.slice(0, 100)}…`,
    );
  }
  resp = await portalFetch(jar, otpForm.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(otpForm.action).origin,
      Referer: lastUrl,
    },
    body: otpBody.toString(),
  });
  if (!resp.res.ok) {
    throw new CitPortalError(
      `OTP POST 失敗 (HTTP ${resp.res.status})`,
      "mfa",
    );
  }
  html = await resp.res.text();
  lastUrl = resp.finalUrl;
  debugLog("after OTP POST", html);

  // OTP 誤りなら OTP フォームが再び表示される
  if (parseFormById(html, lastUrl, "kc-otp-login-form")) {
    // Keycloakが返したエラーメッセージを抽出してログ可能な形にする
    const $err = cheerio.load(html);
    const alert = $err(
      ".alert-error, .pf-v5-c-alert__title, .pf-c-alert__title, [data-testid='login-error'], #input-error-otp",
    )
      .first()
      .text()
      .trim();
    throw new CitPortalError(
      `OTPコードが不正(時計ズレ or シークレット間違い)${alert ? ` [${alert.slice(0, 120)}]` : ""}`,
      "mfa",
    );
  }

  // 7. SAML auto-submit form を解析して SP にPOST
  const samlForm = parseFirstPostForm(html, lastUrl);
  if (!samlForm || !samlForm.fields.SAMLResponse) {
    throw new CitPortalError(
      "SAMLResponseが見つかりません(認証フロー想定外)",
      "session",
    );
  }
  const samlBody = new URLSearchParams();
  for (const [k, v] of Object.entries(samlForm.fields)) {
    samlBody.set(k, v);
  }
  if (DEBUG) {
    console.log(
      `[cit-portal][saml-post] action=${samlForm.action} fields=[${Object.keys(samlForm.fields).join(",")}]`,
    );
  }
  resp = await portalFetch(jar, samlForm.action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: new URL(samlForm.action).origin,
      Referer: lastUrl,
    },
    body: samlBody.toString(),
  });
  if (!resp.res.ok) {
    throw new CitPortalError(
      `SAMLResponse POST 失敗 (HTTP ${resp.res.status})`,
      "session",
    );
  }
  html = await resp.res.text();
  lastUrl = resp.finalUrl;
  debugLog("after SAML POST", html);
  if (DEBUG) {
    console.log(`[cit-portal][saml-post] finalUrl=${lastUrl}`);
    // Cookie 状態の表示(各host単位、値はマスク)
    const portalHost = new URL(baseUrl).host;
    const portalCookies = jar.get(portalHost);
    console.log(
      `[cit-portal][cookies] ${portalHost}: ${portalCookies ? [...portalCookies.keys()].join(", ") : "(none)"}`,
    );
    // form/auto-submit/meta-refresh/JSリダイレクトの痕跡を探す
    const metaRefresh = html.match(
      /<meta[^>]*http-equiv=["']refresh["'][^>]*content=["']([^"']+)["']/i,
    );
    const jsRedirect = html.match(
      /(?:window\.location(?:\.href)?\s*=\s*|location\.href\s*=\s*)["']([^"']+)["']/i,
    );
    const errorMsg = (() => {
      const $$ = cheerio.load(html);
      return $$(".errorblock, .alert-danger, .frInformation, [class*='error']")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
    })();
    console.log(
      `[cit-portal][saml-post] meta-refresh=${metaRefresh?.[1] ?? "(none)"} js-redirect=${jsRedirect?.[1] ?? "(none)"} err="${errorMsg}"`,
    );
    // <body> セクションの中身だけ抽出して 16KB まで
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    console.log(
      `[cit-portal][saml-post] body content (first 16KB):\n${bodyContent.slice(0, 16000)}`,
    );
    // form 構造を整理
    const $ck = cheerio.load(html);
    $ck("form").each((_, fEl) => {
      const $f = $ck(fEl);
      const id = $f.attr("id") || "(no id)";
      const action = $f.attr("action") || "(no action)";
      const method = $f.attr("method") || "GET";
      const inputs = $f
        .find("input")
        .map((_, el) => {
          const n = $ck(el).attr("name");
          const t = $ck(el).attr("type") || "text";
          return n ? `${n}(${t})` : null;
        })
        .toArray()
        .filter(Boolean);
      console.log(
        `[cit-portal][saml-post-form] id=${id} method=${method} action=${action} inputs=[${inputs.join(",")}]`,
      );
    });
    // <body onload="..."> の autosubmit 検出
    const bodyOnload = $ck("body").attr("onload") || "";
    if (bodyOnload) {
      console.log(`[cit-portal][saml-post-onload] ${bodyOnload}`);
    }
  }

  // 時間割テーブルが含まれていればここで完了
  if (html.includes("classTable")) {
    return html;
  }

  // SAML完了後の Pky00102 中継ページの autoLogin ボタンを擬似押下。
  // 通常はJSが loginForm:autoLogin を click→form submit する仕組みだが、
  // 我々はJSを実行しないので、フォームPOSTで等価の挙動を再現する。
  // (これが成功すると 302 でホーム Pkx00701 に飛ぶ)
  if (html.includes("Pky00102") && html.includes("autoLogin")) {
    const $tr = cheerio.load(html);
    const $form = $tr("form#loginForm");
    if ($form.length > 0) {
      const action = new URL(
        $form.attr("action") || "",
        lastUrl,
      ).toString();
      const body = new URLSearchParams();
      $form.find("input").each((_, el) => {
        const n = $tr(el).attr("name");
        const v = $tr(el).attr("value") ?? "";
        if (n) body.set(n, v);
      });
      // 隠し submit ボタンの値(JSF はボタン名を含めることでそれが押されたと判定)
      body.set("loginForm:autoLogin", "");
      if (DEBUG) {
        console.log(
          `[cit-portal][autoLogin] POST ${action} fields=[${[...body.keys()].join(",")}]`,
        );
      }
      const r = await portalFetch(jar, action, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: new URL(action).origin,
          Referer: lastUrl,
        },
        body: body.toString(),
      });
      if (r.res.ok) {
        html = await r.res.text();
        lastUrl = r.finalUrl;
        debugLog("after autoLogin POST", html);
      }
    }
  }

  // 時間割テーブルが含まれていればここで完了(autoLogin直後にもチェック)
  if (html.includes("classTable")) {
    return html;
  }

  // ホームページ(Pkx00701)に着地した場合は menuForm 経由で時間割へナビゲート。
  // JSF/PrimeFaces のサイドメニュー押下を再現する形。
  // 必要なフィールド: menuForm 自身, rx-token, rx-loginKey, rx-deviceKbn,
  // rx-loginType, javax.faces.ViewState, menuForm:mainMenu_menuid, menuForm:mainMenu
  if (
    html.includes("Pkx00701") ||
    html.includes("rx-token") ||
    html.includes("menuForm")
  ) {
    const $home = cheerio.load(html);
    const $menu = $home("form#menuForm, form[id$=':menuForm']").first();
    if ($menu.length > 0) {
      const fields: Record<string, string> = {};
      $menu.find("input").each((_, el) => {
        const name = $home(el).attr("name");
        const value = $home(el).attr("value") ?? "";
        if (name) fields[name] = value;
      });
      // 時間割表メニュー項目の menuid を探す。
      // PrimeFaces の menu リンクは
      //   <a data-pfconfirmcommand="...'menuForm:mainMenu_menuid':'X_Y_Z'..."><span class="ui-menuitem-text">{ラベル}</span></a>
      // という構造。span のラベル完全一致(=「時間割表」)で正しいリンクを特定する。
      let menuid: string | null = null;
      type MenuOpt = { label: string; menuid: string };
      const menuOpts: MenuOpt[] = [];
      $home("a[data-pfconfirmcommand]").each((_, el) => {
        const $a = $home(el);
        const cmd = $a.attr("data-pfconfirmcommand") || "";
        const m = cmd.match(/'menuForm:mainMenu_menuid'\s*:\s*'([^']+)'/);
        if (!m) return;
        const label =
          $a.find("span.ui-menuitem-text").first().text().trim() ||
          $a.text().trim();
        menuOpts.push({ label, menuid: m[1] });
      });
      // 完全一致 "時間割表" が最優先、なければ部分一致(試験時間割等は除外)
      const exact = menuOpts.find((o) => o.label === "時間割表");
      const partial = exact
        ? null
        : menuOpts.find(
            (o) => o.label.includes("時間割") && !o.label.includes("試験"),
          );
      menuid = exact?.menuid ?? partial?.menuid ?? null;
      if (DEBUG) {
        const display = menuOpts
          .filter(
            (o) =>
              o.label.includes("時間割") ||
              o.label.includes("履修") ||
              o.label.includes("授業"),
          )
          .map((o) => `"${o.label}":${o.menuid}`)
          .join(", ");
        console.log(
          `[cit-portal][menu-nav] candidates=[${display}] picked=${exact ? "exact" : partial ? "partial" : "(none)"} menuid=${menuid} fields=[${Object.keys(fields).join(",")}]`,
        );
      }
      if (menuid) {
        const navBody = new URLSearchParams();
        for (const [k, v] of Object.entries(fields)) navBody.set(k, v);
        // ブラウザが menu クリック時に出すパラメータをエミュレート
        // (HARから取った組み合わせ: menuForm, rx.sync.source, menuForm:mainMenu, menuForm:mainMenu_menuid)
        navBody.set("menuForm", "menuForm");
        navBody.set("rx.sync.source", "menuForm:mainMenu");
        navBody.set("menuForm:mainMenu", "menuForm:mainMenu");
        navBody.set("menuForm:mainMenu_menuid", menuid);
        const navAction = $menu.attr("action")
          ? new URL($menu.attr("action") || "", lastUrl).toString()
          : lastUrl;
        // ※ Faces-Request:partial/ajax は付けない(付けると JSF が XML を返してしまう)
        //   通常のフォーム POST として送ると、サーバーは新ビュー(時間割HTML)を返す
        const r = await portalFetch(jar, navAction, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: new URL(navAction).origin,
            Referer: lastUrl,
          },
          body: navBody.toString(),
        });
        if (r.res.ok) {
          html = await r.res.text();
          lastUrl = r.finalUrl;
          debugLog("after menu nav POST", html);
          if (DEBUG) {
            console.log(
              `[cit-portal][menu-nav] action=${navAction} finalUrl=${lastUrl}`,
            );
          }
        }
      }
    }
  }

  // 直接GETもフォールバックとして試す
  if (!html.includes("classTable")) {
    const r = await portalFetch(jar, `${baseUrl}${TIMETABLE_PATH}`, undefined);
    if (r.res.ok) {
      html = await r.res.text();
      debugLog("after direct timetable GET", html);
    }
  }

  return html;
}

// ─────────────────────────────────────────
// 時間割パース
// ─────────────────────────────────────────
function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function periodStartTime(period: number): string {
  // 1限=09:00, 2限=10:00, ..., 10限=18:00
  return hhmm(8 + period, 0);
}

function periodEndTime(period: number): string {
  // 各限60分: 1限の終わりが10:00, ..., 10限の終わりは19:00
  return hhmm(9 + period, 0);
}

function semesterRange(
  year: number,
  isFirstHalf: boolean,
): { from: Date; to: Date } {
  // JST 基準:
  //   前期 = 4/1 00:00 JST 〜 9/30 23:59 JST
  //   後期 = 10/1 00:00 JST 〜 (year+1) 3/31 23:59 JST
  // JSTは UTC+9 なので Date.UTC で時刻を9時間前にずらして「JSTの00:00」を作る。
  if (isFirstHalf) {
    return {
      from: new Date(Date.UTC(year, 3, 1, -9, 0, 0)), // 4/1 00:00 JST
      to: new Date(Date.UTC(year, 9, 0, 14, 59, 59)), // 9/30 23:59 JST
    };
  }
  return {
    from: new Date(Date.UTC(year, 9, 1, -9, 0, 0)), // 10/1 00:00 JST
    to: new Date(Date.UTC(year + 1, 3, 0, 14, 59, 59)), // 3/31 23:59 JST
  };
}

function extractClassesFromTable(
  $: cheerio.CheerioAPI,
  table: Element,
): CitPortalClass[] {
  const $table = $(table);
  const out: CitPortalClass[] = [];

  // legend から年度・前期/後期 を読む
  const legend = $table.closest("fieldset").find("legend").text().trim();
  const yearMatch = legend.match(/(\d{4})/);
  // legend に4桁年が無い場合の fallback は JST 基準で現在年を取る。
  // 旧コード: getUTCFullYear() + (9/24/365) > 0 の三項条件は実質常に true
  //          なので UTC 年がそのまま使われ、cron が 04:00 JST に走った
  //          年明け 0:00〜9:00 JST で UTC がまだ前年だと年がズレる。
  const year = yearMatch
    ? Number(yearMatch[1])
    : new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
  const isFirstHalf = legend.includes("前期");
  const { from: effectiveFrom, to: effectiveTo } = semesterRange(
    year,
    isFirstHalf,
  );

  $table.find("tbody > tr").each((_, tr) => {
    const $cells = $(tr).find("td");
    const periodText = $cells.eq(0).text().trim();
    const period = Number(periodText);
    if (!period || !Number.isFinite(period)) return;

    // 月-土 = idx 1..6
    for (let dayIdx = 0; dayIdx < 6; dayIdx++) {
      const $cell = $cells.eq(1 + dayIdx);
      if ($cell.length === 0) continue;
      const $info = $cell.find(".jugyo-info").first();
      if ($info.length === 0) continue;
      if ($info.hasClass("noClass")) continue;

      const courseName = $info.find(".fontB").first().text().trim();
      if (!courseName) continue;

      // 教員と教室を div の並びから推定
      // パターン:
      //   <div class="fontB">{科目}</div>
      //   <div class="">{教員}</div>
      //   <div class=""><span>{教室}</span>／<span>{キャンパス}</span></div>
      //   <div class="taniSu">{単位数}</div>
      //   <div class="sign signClass">{種別}</div>
      //   <div>{ボタン等}</div>
      let teacher: string | null = null;
      let classroom: string | null = null;
      $info.children("div").each((_, divEl) => {
        const $div = $(divEl);
        if (
          $div.hasClass("fontB") ||
          $div.hasClass("taniSu") ||
          $div.hasClass("sign") ||
          $div.hasClass("noTextIconLine")
        ) {
          return;
        }
        if ($div.find("button").length > 0) return;
        // 教室/キャンパスは <span>{教室}</span><span>{キャンパス}</span> の形。
        // 後期で未確定の場合は <span></span><span>{キャンパス}</span> となり、
        // 空spanのときは classroom = null (構造で判定し、教員と取り違えない)。
        const $spans = $div.children("span");
        if ($spans.length >= 2) {
          const roomText = $spans.first().text().trim();
          classroom = roomText || null;
          return;
        }
        const text = $div.text().trim();
        if (!text) return;
        if (teacher === null) teacher = text;
      });

      out.push({
        dayOfWeek: dayIdx + 1,
        period,
        endPeriod: period,
        startTime: periodStartTime(period),
        endTime: periodEndTime(period),
        courseName,
        classroom,
        teacher,
        effectiveFrom,
        effectiveTo,
      });
    }
  });

  return out;
}

/**
 * 連続コマ統合: 同じ (effectiveFrom, dayOfWeek, courseName) で
 * period が連続している行を 1 行にまとめ endPeriod / endTime を伸ばす。
 */
function mergeConsecutivePeriods(rows: CitPortalClass[]): CitPortalClass[] {
  const sorted = [...rows].sort((a, b) => {
    const af = a.effectiveFrom?.getTime() ?? 0;
    const bf = b.effectiveFrom?.getTime() ?? 0;
    if (af !== bf) return af - bf;
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.period - b.period;
  });
  const merged: CitPortalClass[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.effectiveFrom?.getTime() === r.effectiveFrom?.getTime() &&
      last.dayOfWeek === r.dayOfWeek &&
      last.courseName === r.courseName &&
      last.endPeriod + 1 === r.period &&
      last.classroom === r.classroom &&
      last.teacher === r.teacher
    ) {
      last.endPeriod = r.period;
      last.endTime = r.endTime;
      continue;
    }
    merged.push({ ...r });
  }
  return merged;
}

export function parseTimetableHtml(html: string): CitPortalClass[] {
  const $ = cheerio.load(html);
  const tables = $("table.classTable").toArray();
  if (tables.length === 0) {
    throw new CitPortalError(
      "時間割テーブル(table.classTable)が見つかりません",
      "parse",
    );
  }
  const all: CitPortalClass[] = [];
  for (const t of tables) {
    all.push(...extractClassesFromTable($, t as Element));
  }
  return mergeConsecutivePeriods(all);
}

// ─────────────────────────────────────────
// TOTP
// ─────────────────────────────────────────
export function generateTotpCode(secretBase32: string): string {
  const totp = new TOTP({
    secret: secretBase32,
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  });
  return totp.generate();
}

// ─────────────────────────────────────────
// エントリーポイント
// ─────────────────────────────────────────
/**
 * CITポータルから時間割を取得する。
 *
 * @throws CitPortalError 各ステージで失敗した場合
 */
export async function fetchCitPortalTimetable(
  username: string,
  password: string,
  totpSecret: string,
  totpDeviceName: string | null = null,
): Promise<CitPortalClass[]> {
  const baseUrl = (process.env.CIT_PORTAL_BASE_URL ?? DEFAULT_BASE).replace(
    /\/$/,
    "",
  );
  if (!username || !password || !totpSecret) {
    throw new CitPortalError(
      "認証情報(ユーザーID/パスワード/TOTPシークレット)が空です",
      "config",
    );
  }
  const jar: HostCookieJar = new Map();
  const html = await login(
    jar,
    baseUrl,
    username,
    password,
    totpSecret,
    totpDeviceName,
  );
  return parseTimetableHtml(html);
}
