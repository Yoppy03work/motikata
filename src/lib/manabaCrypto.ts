// manaba 用のパスワード暗号化。
//
// 仕様:
//   - AES-256-GCM
//   - 鍵: SESSION_SECRET から SHA-256 で 32B に丸める(別キーは要らない)
//     SESSION_SECRET は 32+ 文字必須なので十分な entropy 想定
//   - 出力: base64url で `iv.ciphertext.authTag` を `:` 連結
//   - SESSION_SECRET をローテートすると既存の暗号文は復号不能になる
//     (その場合はユーザに再入力してもらう運用)

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function key(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[security] SESSION_SECRET must be set (32+ chars)");
    }
    return createHash("sha256")
      .update("dev-only-fallback-for-manaba-crypto")
      .digest();
  }
  return createHash("sha256").update(s).digest();
}

export function encryptManabaPassword(plain: string): string {
  if (!plain) throw new Error("empty password");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    ct.toString("base64url"),
    tag.toString("base64url"),
  ].join(":");
}

export function decryptManabaPassword(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("invalid ciphertext format");
  const [ivB, ctB, tagB] = parts;
  const iv = Buffer.from(ivB, "base64url");
  const ct = Buffer.from(ctB, "base64url");
  const tag = Buffer.from(tagB, "base64url");
  if (iv.length !== IV_LEN) throw new Error("invalid iv length");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf8");
}
