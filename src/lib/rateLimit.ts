// Postgres 永続のレート制限。プロセス再起動やスケールアウトでも状態が残る。
// 単一ユーザー前提のアプリなので書き込み頻度は小さく、DB 往復のオーバーヘッドは許容できる。

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type LockoutPolicy = {
  maxAttempts: number;
  windowSec: number;
  lockoutSec: number;
};

// クライアント単位(anon Cookie / IP + UA)の上限。
export const CLIENT_POLICY: LockoutPolicy = {
  maxAttempts: 5,
  windowSec: 30 * 60,
  lockoutSec: 15 * 60,
};

// クライアントを区別しない全体の上限。clientKey は Cookie を送らず UA を毎回
// 変えるだけで別 bucket になるため、それだけでは PIN 総当たりを止められない。
// 単一ユーザーのアプリなので、全体で失敗が重なったらログイン自体を止める。
// (正規ユーザーもこの間はログインできないが、既存セッションには影響しない)
export const GLOBAL_KEY = "global";
export const GLOBAL_POLICY: LockoutPolicy = {
  maxAttempts: 20,
  windowSec: 30 * 60,
  lockoutSec: 30 * 60,
};

export async function checkLockout(
  key: string,
  policy: LockoutPolicy = CLIENT_POLICY,
): Promise<{
  allowed: boolean;
  retryAfterSec?: number;
  remaining: number;
}> {
  const now = Date.now();
  const row = await prisma.loginAttempt.findUnique({ where: { key } });
  if (!row) return { allowed: true, remaining: policy.maxAttempts };

  if (row.lockoutUntil && row.lockoutUntil.getTime() > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((row.lockoutUntil.getTime() - now) / 1000),
      remaining: 0,
    };
  }
  if (now - row.windowStart.getTime() > policy.windowSec * 1000) {
    await prisma.loginAttempt.delete({ where: { key } }).catch(() => {});
    return { allowed: true, remaining: policy.maxAttempts };
  }
  return { allowed: true, remaining: Math.max(0, policy.maxAttempts - row.failures) };
}

// 同一 key への並行 recordFailure を取りこぼさないため、INSERT ... ON CONFLICT
// DO UPDATE で原子的にインクリメント+判定を行う。Postgres のロー単位ロックに
// 任せることで、read-modify-write の race を排除する。
export async function recordFailure(
  key: string,
  policy: LockoutPolicy = CLIENT_POLICY,
): Promise<{
  failures: number;
  lockedOut: boolean;
  retryAfterSec?: number;
  remaining: number;
}> {
  const { maxAttempts, windowSec, lockoutSec } = policy;
  const rows = await prisma.$queryRaw<
    Array<{ failures: number; lockoutUntil: Date | null }>
  >(Prisma.sql`
    INSERT INTO "LoginAttempt" ("key", "failures", "windowStart", "lockoutUntil", "updatedAt")
    VALUES (${key}, 1, NOW(), NULL, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN NOW() - "LoginAttempt"."windowStart" > make_interval(secs => ${windowSec})
          THEN 1
        ELSE "LoginAttempt"."failures" + 1
      END,
      "windowStart" = CASE
        WHEN NOW() - "LoginAttempt"."windowStart" > make_interval(secs => ${windowSec})
          THEN NOW()
        ELSE "LoginAttempt"."windowStart"
      END,
      "lockoutUntil" = CASE
        WHEN (
          CASE
            WHEN NOW() - "LoginAttempt"."windowStart" > make_interval(secs => ${windowSec})
              THEN 1
            ELSE "LoginAttempt"."failures" + 1
          END
        ) >= ${maxAttempts}
          THEN NOW() + make_interval(secs => ${lockoutSec})
        ELSE "LoginAttempt"."lockoutUntil"
      END,
      "updatedAt" = NOW()
    RETURNING "failures", "lockoutUntil"
  `);

  const row = rows[0];
  const now = Date.now();
  if (row.lockoutUntil && row.lockoutUntil.getTime() > now) {
    return {
      failures: row.failures,
      lockedOut: true,
      retryAfterSec: Math.ceil((row.lockoutUntil.getTime() - now) / 1000),
      remaining: 0,
    };
  }
  return {
    failures: row.failures,
    lockedOut: false,
    remaining: Math.max(0, maxAttempts - row.failures),
  };
}

export async function recordSuccess(key: string): Promise<void> {
  await prisma.loginAttempt.delete({ where: { key } }).catch(() => {});
}

export const ANON_COOKIE_NAME = "mochikata_anon_id";
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1年

/**
 * クライアント識別子を返す。
 * - TRUST_PROXY=true: 前段プロキシが付ける x-forwarded-for / x-real-ip + UA を採用
 * - TRUST_PROXY=false: 長期 anon Cookie + UA を採用
 *   (UA だけだと同 UA のユーザー全員が同じ bucket になり、攻撃者が無関係な
 *   ユーザーをロックアウトできるため。Cookie はブラウザごとに独立)
 *
 * anonId は呼び出し側(login route)で Cookie から取得し、なければ生成して
 * レスポンスにセットする。
 */
export function clientKey(req: Request, anonId?: string): string {
  const trust = process.env.TRUST_PROXY === "true";
  const ua = req.headers.get("user-agent") ?? "";
  const uaHash = createHash("sha256").update(ua).digest("hex").slice(0, 16);

  if (trust) {
    const fwd = req.headers.get("x-forwarded-for");
    const ip = fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip");
    if (ip) return `ip:${ip}|ua:${uaHash}`;
  }

  if (anonId) return `anon:${anonId}|ua:${uaHash}`;
  // Cookie 取得前(初回リクエスト)は UA のみ。次回以降は Cookie 経由で個別化される
  return `ua-only:${uaHash}`;
}
