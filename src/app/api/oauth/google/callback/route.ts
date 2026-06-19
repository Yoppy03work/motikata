// GET /api/oauth/google/callback?code=...&state=...
//
// 1. state Cookie (mochikata_google_oauth_state) と URL の state を比較。
//    HMAC 検証 + 一致確認の両方を行う。
// 2. code を access_token + refresh_token に交換。
// 3. userinfo endpoint で email を取得。
// 4. refresh_token を暗号化して GoogleCredential に upsert (singleton)。
// 5. state Cookie を消して /settings に redirect。

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptGoogleRefreshToken } from "@/lib/googleCrypto";
import {
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  GOOGLE_OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from "@/lib/googleOAuth";

function redirectToSettings(message: string, isError: boolean): NextResponse {
  const url = new URL(
    `/settings?google=${isError ? "error" : "ok"}&msg=${encodeURIComponent(message)}`,
    process.env.GOOGLE_OAUTH_REDIRECT_BASE ?? "http://localhost:3000",
  );
  const res = NextResponse.redirect(url, { status: 302 });
  // 一度使った state Cookie は必ず破棄(再生攻撃 + 履歴に残さない)。
  res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    maxAge: 0,
    path: "/api/oauth/google/",
  });
  return res;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    // ユーザーが Google 画面で「キャンセル」を押した等。
    return redirectToSettings(`Google 側でキャンセルされました (${error})`, true);
  }
  if (!code || !state) {
    return redirectToSettings("code または state がありません", true);
  }

  // Cookie の state と URL の state が一致 + HMAC 検証通る必要がある。
  // どちらか欠けたら CSRF or 改ざんとみなして拒否。
  const cookieState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (!cookieState || cookieState !== state || !verifyOAuthState(state)) {
    return redirectToSettings("state 検証に失敗しました。やり直してください", true);
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return redirectToSettings(`トークン交換に失敗: ${msg.slice(0, 120)}`, true);
  }

  if (!tokens.refresh_token) {
    // prompt=consent を付けてもらった ことで refresh_token が来るはず。
    // 来なければ Google 側で grant が壊れている可能性が高い。
    // 一度 https://myaccount.google.com/permissions から既存接続を消してもらう案内。
    return redirectToSettings(
      "refresh_token が発行されませんでした。Google アカウントの『接続済みアプリ』からモチカタを一度削除してから再連携してください",
      true,
    );
  }

  let email: string;
  try {
    email = await fetchGoogleUserEmail(tokens.access_token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return redirectToSettings(`アカウント情報取得に失敗: ${msg.slice(0, 120)}`, true);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const encrypted = encryptGoogleRefreshToken(tokens.refresh_token);

  // singletonKey で 1 行制約。既存があれば上書き(再連携で新しい refresh_token に
  // 差し替わるのが正常。古い token は Google 側で自動 revoke される)。
  await prisma.googleCredential.upsert({
    where: { singletonKey: "default" },
    create: {
      singletonKey: "default",
      email,
      refreshTokenEnc: encrypted,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope,
    },
    update: {
      email,
      refreshTokenEnc: encrypted,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope,
      lastError: null,
    },
  });

  // 再連携時はぶら下がっている GoogleCalendar 行の syncToken を一旦 null に
  // 戻し、次回 sync で events.list を timeMin=now-30d の full sync に降格させる。
  // (Phase 2 で syncToken は GoogleCalendar 側に移管したため、credential 単体
  //  ではなくぶら下がる行全てを更新する)
  await prisma.googleCalendar.updateMany({
    where: { credential: { singletonKey: "default" } },
    data: { syncToken: null },
  });

  return redirectToSettings(`Google カレンダー連携完了: ${email}`, false);
}
