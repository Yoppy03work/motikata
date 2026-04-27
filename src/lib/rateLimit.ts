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

/**
 * クライアント識別子を返す。
 * - TRUST_PROXY=true の場合のみ x-forwarded-for / x-real-ip を採用(リバースプロキシ前提)
 * - それ以外は IP + User-Agent のハッシュをキーにして、正規ユーザーの操作で
 *   別クライアントの攻撃者がロックアウトを引き起こしにくくする。
 *   ヘッダ偽装でキーを揺らしても、User-Agent を変えた試行は別キーに分かれるだけで
 *   全体の上限(DB行数)は増えるが個々の試行回数上限は保たれる。
 */
export function clientKey(req: Request): string {
  const trust = process.env.TRUST_PROXY === "true";
  const ua = req.headers.get("user-agent") ?? "";
  const uaHash = createHash("sha256").update(ua).digest("hex").slice(0, 16);

  if (trust) {
    const fwd = req.headers.get("x-forwarded-for");
    const ip = fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip");
    if (ip) return `ip:${ip}|ua:${uaHash}`;
  }
  return `anon|ua:${uaHash}`;
}
