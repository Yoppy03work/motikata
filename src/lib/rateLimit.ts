// Postgres 永続のレート制限。プロセス再起動やスケールアウトでも状態が残る。
// 単一ユーザー前提のアプリなので書き込み頻度は小さく、DB 往復のオーバーヘッドは許容できる。

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const WINDOW_MS = 30 * 60_000;

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

export async function recordFailure(key: string): Promise<{
  lockedOut: boolean;
  retryAfterSec?: number;
  remaining: number;
}> {
  const now = new Date();
  const existing = await prisma.loginAttempt.findUnique({ where: { key } });

  const withinWindow =
    existing && now.getTime() - existing.windowStart.getTime() < WINDOW_MS;

  const nextFailures = (withinWindow ? existing!.failures : 0) + 1;
  const lockedOut = nextFailures >= MAX_ATTEMPTS;
  const lockoutUntil = lockedOut ? new Date(now.getTime() + LOCKOUT_MS) : null;
  const windowStart = withinWindow ? existing!.windowStart : now;

  await prisma.loginAttempt.upsert({
    where: { key },
    create: { key, failures: nextFailures, windowStart, lockoutUntil },
    update: { failures: nextFailures, windowStart, lockoutUntil },
  });

  if (lockedOut) {
    return {
      lockedOut: true,
      retryAfterSec: Math.ceil(LOCKOUT_MS / 1000),
      remaining: 0,
    };
  }
  return { lockedOut: false, remaining: MAX_ATTEMPTS - nextFailures };
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
