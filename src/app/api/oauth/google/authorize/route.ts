// GET /api/oauth/google/authorize
// Google OAuth フローの起点。state を発行 → HttpOnly Cookie に格納 →
// Google authorize endpoint に 302 redirect。
//
// Cookie:
//   name = mochikata_google_oauth_state
//   HttpOnly, SameSite=Lax, Secure (resolveCookieSecure)
//   Path=/api/oauth/google/ (callback だけが読めばよい)
//   maxAge = 10 min
//
// 認可必須(セッションログイン前提)。middleware で /api/ は session cookie
// チェック + Origin/Referer 検証が掛かるので、ここでは getSession のみ。

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  buildAuthorizeUrl,
  GOOGLE_OAUTH_STATE_COOKIE,
  issueOAuthState,
} from "@/lib/googleOAuth";
import { resolveCookieSecure } from "@/lib/cookieSecure";

const STATE_COOKIE_MAX_AGE = 10 * 60; // seconds

export async function GET() {
  const session = await getSession();
  if (!session.authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let authorizeUrl: string;
  try {
    const state = issueOAuthState();
    authorizeUrl = buildAuthorizeUrl(state);
    const res = NextResponse.redirect(authorizeUrl, { status: 302 });
    res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: resolveCookieSecure(),
      sameSite: "lax",
      path: "/api/oauth/google/",
      maxAge: STATE_COOKIE_MAX_AGE,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: `Google OAuth 初期化に失敗しました: ${msg}` },
      { status: 500 },
    );
  }
}
