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

// Cookie の状態を返す。
// - existing: クライアントが提示してきた anon ID(レート制限の key に使う)
// - freshIdToSet: 新規発行する ID(レスポンスでセットするだけで、今回の key には使わない)
//
// 重要: クライアントが Cookie を毎回クリアしても、新規発行 ID を即時 key にしてしまうと
// 5回ルールを完全バイパスできる。そのため Cookie 未提示リクエストは
// 既存 Cookie 持ちと隔離した「安定 fallback bucket」に集約する(clientKey 側の責務)。
async function readAnonCookieState(): Promise<{
  existing: string | null;
  freshIdToSet: string | null;
}> {
  const jar = await cookies();
  const v = jar.get(ANON_COOKIE_NAME)?.value;
  if (v && /^[0-9a-f-]{8,}$/.test(v)) return { existing: v, freshIdToSet: null };
  return { existing: null, freshIdToSet: randomUUID() };
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

  const { existing, freshIdToSet } = await readAnonCookieState();
  // key には EXISTING の Cookie 値だけ渡す。未提示なら clientKey は安定 fallback を使う。
  const key = clientKey(req, existing ?? undefined);
  const finalize = (res: NextResponse) => {
    if (freshIdToSet) attachAnonCookie(res, freshIdToSet);
    return res;
  };

  const lock = await checkLockout(key);
  if (!lock.allowed) {
    return finalize(
      NextResponse.json(
        {
          error: `試行回数が多すぎます。${Math.ceil((lock.retryAfterSec ?? 0) / 60)}分後にお試しください`,
        },
        { status: 429, headers: { "Retry-After": String(lock.retryAfterSec ?? 60) } },
      ),
    );
  }

  const parsed = PinLoginInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return finalize(NextResponse.json({ error: "PINが不正です" }, { status: 400 }));
  }
  const result = await verifyPin(parsed.data.pin);
  if (!result.ok) {
    const fail = await recordFailure(key);
    if (fail.lockedOut) {
      return finalize(
        NextResponse.json(
          {
            error: `失敗回数が上限に達しました。${Math.ceil((fail.retryAfterSec ?? 0) / 60)}分間ロックされます`,
          },
          { status: 429 },
        ),
      );
    }
    return finalize(
      NextResponse.json(
        { error: `PINが違います(残り${fail.remaining}回)` },
        { status: 401 },
      ),
    );
  }

  await recordSuccess(key);
  const session = await getSession();
  session.authed = true;
  session.userId = result.userId;
  await session.save();
  return finalize(NextResponse.json({ ok: true }));
}
