// Google OAuth 2.0 (Authorization Code grant, offline access) ユーティリティ。
//
// 役割:
//   - authorize URL の組み立て
//   - state の HMAC 署名・検証 (CSRF + redirect 後の改ざん防止)
//   - code → token 交換
//   - refresh_token → access_token 再発行
//
// 副作用は一切持たない(DB アクセス無し)。呼び出し側で永続化や Cookie 設定を行う。

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

// state Cookie 名。Phase 11: Next.js App Router の route.ts は HTTP method
// handler 以外の named export を許可しないため、ここに集約。
export const GOOGLE_OAUTH_STATE_COOKIE = "mochikata_google_oauth_state";

// Phase 1 の最低スコープ(双方向の Phase 3 で同じ scope を使うので最初から両用)。
// readonly に絞ると Phase 3 で同意を取り直す必要が出るため calendar を採る。
export const GOOGLE_OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

// state は HMAC で署名して Cookie に格納し、callback で検証する。
// Cookie は HttpOnly + SameSite=Lax で 10 分で expire させる想定(設定は呼び出し側)。
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_DELIMITER = ".";

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[security] SESSION_SECRET must be set (>= 32 chars)");
    }
    return "dev-only-google-state-secret-fallback-not-secure";
  }
  return s;
}

// state = base64url(nonce) + "." + base64url(expiresAtMs) + "." + base64url(HMAC)
export function issueOAuthState(): string {
  const nonce = randomBytes(16).toString("base64url");
  const expiresAt = String(Date.now() + STATE_TTL_MS);
  const body = `${nonce}${STATE_DELIMITER}${Buffer.from(expiresAt).toString("base64url")}`;
  const mac = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}${STATE_DELIMITER}${mac}`;
}

export function verifyOAuthState(state: string | null | undefined): boolean {
  if (!state) return false;
  const parts = state.split(STATE_DELIMITER);
  if (parts.length !== 3) return false;
  const [nonce, expiresB64, mac] = parts;
  const body = `${nonce}${STATE_DELIMITER}${expiresB64}`;
  const expected = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  // timingSafeEqual は長さが違うと throw する。先に長さチェック。
  if (expected.length !== mac.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return false;
  try {
    const expiresAt = Number(Buffer.from(expiresB64, "base64url").toString("utf8"));
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  } catch {
    return false;
  }
  return true;
}

function redirectUri(): string {
  const base = process.env.GOOGLE_OAUTH_REDIRECT_BASE;
  if (!base) {
    throw new Error("[google-oauth] GOOGLE_OAUTH_REDIRECT_BASE is not set");
  }
  // 末尾スラッシュ無しで指定される想定だが念のため正規化。
  return `${base.replace(/\/+$/, "")}/api/oauth/google/callback`;
}

export function buildAuthorizeUrl(state: string): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("[google-oauth] GOOGLE_OAUTH_CLIENT_ID is not set");
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    // offline = refresh_token を発行してもらう
    access_type: "offline",
    // 既に同意済みでも refresh_token を確実に返してもらうため consent を強制。
    // (既存 grant が残っていると refresh_token が省略されるケースがある)
    prompt: "consent",
    state,
    include_granted_scopes: "true",
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("[google-oauth] CLIENT_ID/SECRET not set");
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[google-oauth] token exchange failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("[google-oauth] CLIENT_ID/SECRET not set");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[google-oauth] refresh failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

// access_token を Google の userinfo endpoint に投げてアカウントの email を取る。
// OAuth 同意で得た access_token は userinfo.email scope を持つので即時呼べる。
export async function fetchGoogleUserEmail(
  accessToken: string,
): Promise<string> {
  const res = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`[google-oauth] userinfo failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { email?: string };
  if (!data.email) throw new Error("[google-oauth] userinfo response missing email");
  return data.email;
}

// 解除用に Google 側でも refresh_token を revoke する。失敗は無視可(DB だけ消せば十分)。
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => {});
}

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  // primary: true は自分の主カレンダー
  primary?: boolean;
  // selected: ユーザーが UI で表示 ON にしているか (default true)
  selected?: boolean;
  // accessRole: "owner" | "writer" | "reader" | "freeBusyReader"
  accessRole?: string;
  // calendarListEntry の色 (id)。null なら Google デフォルト色
  colorId?: string;
  backgroundColor?: string; // 直接 hex で来る場合もある (calendar color resolver の代替)
  // hidden カレンダー (連絡先の誕生日等) は無視したいので使う
  hidden?: boolean;
  deleted?: boolean;
};

type CalendarListResponse = {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
};

// CalendarList を全件取得 (paginated)。selected=true でフィルタしない (ユーザーが
// モチカタ側で別途 enable/disable できるようにするため)。
export async function listCalendarList(
  accessToken: string,
): Promise<GoogleCalendarListEntry[]> {
  const items: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `calendarList failed: ${res.status} ${detail.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as CalendarListResponse;
    for (const c of data.items ?? []) {
      if (c.hidden || c.deleted) continue;
      items.push(c);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}
