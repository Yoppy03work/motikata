import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PinLoginInput } from "@/lib/validation/auth";
import { ensureAppUser, getSession, verifyPin } from "@/lib/auth";
import {
  ANON_COOKIE_MAX_AGE,
  ANON_COOKIE_NAME,
  checkLockout,
  CLIENT_POLICY,
  clientKey,
  GLOBAL_KEY,
  GLOBAL_POLICY,
  recordFailure,
  recordSuccess,
} from "@/lib/rateLimit";
import { issueAnonId, verifyAnonId } from "@/lib/anonId";
import { resolveCookieSecure } from "@/lib/cookieSecure";

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
    secure: resolveCookieSecure(),
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

  const tooMany = (retryAfterSec: number) =>
    finalize(
      NextResponse.json(
        { error: `試行回数が多すぎます。${Math.ceil(retryAfterSec / 60)}分後にお試しください` },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
      ),
    );

  // 全体ロックを先に見る。クライアント単位の bucket は UA を変えるだけで
  // 回避できるため、こちらが総当たりに対する本当の上限になる。
  const globalLock = await checkLockout(GLOBAL_KEY, GLOBAL_POLICY);
  const lock = globalLock.allowed ? await checkLockout(key) : globalLock;
  if (!lock.allowed) return tooMany(lock.retryAfterSec ?? 60);

  const parsed = PinLoginInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return finalize(NextResponse.json({ error: "PINが不正です" }, { status: 400 }));
  }

  // PIN 検証の「前」に試行を失敗として原子的に数える(成功したら下でリセット)。
  // 検証後に数えると、並行リクエストが全部 checkLockout を素通りしてから
  // 一斉に verifyPin に到達し、上限を超えて試行できてしまう。
  const [attempt, globalAttempt] = await Promise.all([
    recordFailure(key),
    recordFailure(GLOBAL_KEY, GLOBAL_POLICY),
  ]);
  if (
    attempt.failures > CLIENT_POLICY.maxAttempts ||
    globalAttempt.failures > GLOBAL_POLICY.maxAttempts
  ) {
    return tooMany(Math.max(attempt.retryAfterSec ?? 0, globalAttempt.retryAfterSec ?? 0) || 60);
  }

  const result = await verifyPin(parsed.data.pin);
  if (!result.ok) {
    if (attempt.lockedOut || globalAttempt.lockedOut) {
      const retryAfterSec = Math.max(attempt.retryAfterSec ?? 0, globalAttempt.retryAfterSec ?? 0);
      return finalize(
        NextResponse.json(
          {
            error: `失敗回数が上限に達しました。${Math.ceil(retryAfterSec / 60)}分間ロックされます`,
          },
          { status: 429 },
        ),
      );
    }
    return finalize(
      NextResponse.json(
        { error: `PINが違います(残り${attempt.remaining}回)` },
        { status: 401 },
      ),
    );
  }

  await Promise.all([recordSuccess(key), recordSuccess(GLOBAL_KEY)]);
  const session = await getSession();
  session.authed = true;
  session.userId = result.userId;
  session.sv = result.sessionVersion;
  await session.save();
  return finalize(NextResponse.json({ ok: true }));
}
