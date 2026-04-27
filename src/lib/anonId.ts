// Anon Cookie の発行・検証。
// 目的: rate-limit の bucket key として使う匿名 ID を「サーバが発行したもの」だけ
// 信用したい。生 UUID を Cookie に入れるとクライアントが任意値を送れて、5回ルールを
// バイパスできるため、サーバ側秘密鍵で HMAC 署名し受信時に検証する。

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const HMAC_LENGTH = 22; // base64url 22 文字 ≒ 132bit、衝突・偽造耐性は十分

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("[security] SESSION_SECRET must be set (32+ chars) for anon-id signing");
  }
  // 開発時のみフォールバック(本番は throw)
  return "dev-only-secret-change-me-please-32chars-min-length-required-x";
}

function hmac(value: string): string {
  return createHmac("sha256", getSecret())
    .update(value)
    .digest("base64url")
    .slice(0, HMAC_LENGTH);
}

export function issueAnonId(): string {
  const id = randomUUID();
  return `${id}.${hmac(id)}`;
}

/**
 * Cookie 値から元の id を取り出す。署名が正しくない場合は null を返す。
 */
export function verifyAnonId(signed: string | undefined | null): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  // 形式チェック(UUID の長さは固定)
  if (id.length !== 36 || sig.length !== HMAC_LENGTH) return null;
  const expected = hmac(id);
  let ok = false;
  try {
    ok = timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return null;
  }
  return ok ? id : null;
}
