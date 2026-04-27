import { NextResponse } from "next/server";
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
import { issueAnonId, verifyAnonId } from "@/lib/anonId";

// Cookie の状態を返す。
// - verifiedExisting: HMAC 署名が正しく検証された ID のみ。これだけが rate-limit の key に使える
// - freshSignedToSet: 新規発行する署名済み ID(レスポンスでセットするだけで、今回の key には使わない)
//
// 重要: 生 UUID をそのまま受け入れると、攻撃者が任意の値を Cookie に詰めて
// 5回ルールをバイパスできる(毎回違う bucket に振り分けられる)。
// 必ずサーバ側秘密(SESSION_SECRET)で署名・検証する。
async function readAnonCookieState(): Promise<{
  verifiedExisting: string | null;
  freshSignedToSet: string | null;
}> {
  const jar = await cookies();
  const raw = jar.get(ANON_COOKIE_NAME)?.value;
  const verified = verifyAnonId(raw);
  if (verified) return { verifiedExisting: verified, freshSignedToSet: null };
  return { verifiedExisting: null, freshSignedToSet: issueAnonId() };
}

function attachAnonCookie(res: NextResponse, signedAnonId: string): NextResponse {
  res.cookies.set(ANON_COOKIE_NAME, signedAnonId, {
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

  const { verifiedExisting, freshSignedToSet } = await readAnonCookieState();
  // key には HMAC 検証済みの ID だけ渡す。未検証(未提示・偽造・改竄)なら
  // clientKey は安定 fallback (UA-only or IP+UA) を返す。
  const key = clientKey(req, verifiedExisting ?? undefined);
  const finalize = (res: NextResponse) => {
    if (freshSignedToSet) attachAnonCookie(res, freshSignedToSet);
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
