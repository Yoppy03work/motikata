// Postgres 永続のレート制限。プロセス再起動やスケールアウトでも状態が残る。
// 単一ユーザー前提のアプリなので書き込み頻度は小さく、DB 往復のオーバーヘッドは許容できる。

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const WINDOW_MS = 30 * 60_000;
const WINDOW_SEC = WINDOW_MS / 1000;
const LOCKOUT_SEC = LOCKOUT_MS / 1000;

export async function checkLockout(key: string): Promise<{
  allowed: boolean;
  retryAfterSec?: number;
  remaining: number;
}> {
  const now = Date.now();
  const row = await prisma.loginAttempt.findUnique({ where: { key } });
  if (!row) return { allowed: true, remaining: MAX_ATTEMPTS };

  if (row.lockoutUntil && row.lockoutUntil.getTime() > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((row.lockoutUntil.getTime() - now) / 1000),
      remaining: 0,
    };
  }
  if (now - row.windowStart.getTime() > WINDOW_MS) {
    await prisma.loginAttempt.delete({ where: { key } }).catch(() => {});
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
  return { allowed: true, remaining: Math.max(0, MAX_ATTEMPTS - row.failures) };
}

// 同一 key への並行 recordFailure を取りこぼさないため、INSERT ... ON CONFLICT
// DO UPDATE で原子的にインクリメント+判定を行う。Postgres のロー単位ロックに
// 任せることで、read-modify-write の race を排除する。
export async function recordFailure(key: string): Promise<{
  lockedOut: boolean;
  retryAfterSec?: number;
  remaining: number;
}> {
  const rows = await prisma.$queryRaw<
    Array<{ failures: number; lockoutUntil: Date | null }>
  >(Prisma.sql`
    INSERT INTO "LoginAttempt" ("key", "failures", "windowStart", "lockoutUntil", "updatedAt")
    VALUES (${key}, 1, NOW(), NULL, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN NOW() - "LoginAttempt"."windowStart" > make_interval(secs => ${WINDOW_SEC})
          THEN 1
        ELSE "LoginAttempt"."failures" + 1
      END,
      "windowStart" = CASE
        WHEN NOW() - "LoginAttempt"."windowStart" > make_interval(secs => ${WINDOW_SEC})
          THEN NOW()
        ELSE "LoginAttempt"."windowStart"
      END,
      "lockoutUntil" = CASE
        WHEN (
          CASE
            WHEN NOW() - "LoginAttempt"."windowStart" > make_interval(secs => ${WINDOW_SEC})
              THEN 1
            ELSE "LoginAttempt"."failures" + 1
          END
        ) >= ${MAX_ATTEMPTS}
          THEN NOW() + make_interval(secs => ${LOCKOUT_SEC})
        ELSE "LoginAttempt"."lockoutUntil"
      END,
      "updatedAt" = NOW()
    RETURNING "failures", "lockoutUntil"
  `);

  const row = rows[0];
  const now = Date.now();
  if (row.lockoutUntil && row.lockoutUntil.getTime() > now) {
    return {
      lockedOut: true,
      retryAfterSec: Math.ceil((row.lockoutUntil.getTime() - now) / 1000),
      remaining: 0,
    };
  }
  return { lockedOut: false, remaining: Math.max(0, MAX_ATTEMPTS - row.failures) };
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
