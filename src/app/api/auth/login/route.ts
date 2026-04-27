import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { PinLoginInput } from "@/lib/validation/auth";
import { ensureAppUser, getSession, verifyPin } from "@/lib/auth";
import {
  ANON_COOKIE_MAX_AGE,
  ANON_COOKIE_NAME,
  checkLockout,
  clientKey,
  recordFailure,
  recordSuccess,
} from "@/lib/rateLimit";

// 受信 Cookie から anon ID を読む。なければ生成して、後でレスポンスにセットする。
// 戻り値: [anonId, isNew] — isNew=true ならレスポンスに Set-Cookie が必要
async function getOrIssueAnonId(): Promise<[string, boolean]> {
  const jar = await cookies();
  const existing = jar.get(ANON_COOKIE_NAME)?.value;
  if (existing && /^[0-9a-f-]{8,}$/.test(existing)) return [existing, false];
  return [randomUUID(), true];
}

function attachAnonCookie(res: NextResponse, anonId: string): NextResponse {
  res.cookies.set(ANON_COOKIE_NAME, anonId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ANON_COOKIE_MAX_AGE,
  });
  return res;
}

export async function POST(req: Request) {
  await ensureAppUser();

  const [anonId, isNewAnon] = await getOrIssueAnonId();
  const key = clientKey(req, anonId);
  const lock = await checkLockout(key);
  if (!lock.allowed) {
    const res = NextResponse.json(
      {
        error: `試行回数が多すぎます。${Math.ceil((lock.retryAfterSec ?? 0) / 60)}分後にお試しください`,
      },
      { status: 429, headers: { "Retry-After": String(lock.retryAfterSec ?? 60) } },
    );
    if (isNewAnon) attachAnonCookie(res, anonId);
    return res;
  }

  const parsed = PinLoginInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const res = NextResponse.json({ error: "PINが不正です" }, { status: 400 });
    if (isNewAnon) attachAnonCookie(res, anonId);
    return res;
  }
  const result = await verifyPin(parsed.data.pin);
  if (!result.ok) {
    const fail = await recordFailure(key);
    let res: NextResponse;
    if (fail.lockedOut) {
      res = NextResponse.json(
        {
          error: `失敗回数が上限に達しました。${Math.ceil((fail.retryAfterSec ?? 0) / 60)}分間ロックされます`,
        },
        { status: 429 },
      );
    } else {
      res = NextResponse.json(
        { error: `PINが違います(残り${fail.remaining}回)` },
        { status: 401 },
      );
    }
    if (isNewAnon) attachAnonCookie(res, anonId);
    return res;
  }

  await recordSuccess(key);
  const session = await getSession();
  session.authed = true;
  session.userId = result.userId;
  await session.save();
  const res = NextResponse.json({ ok: true });
  if (isNewAnon) attachAnonCookie(res, anonId);
  return res;
}
