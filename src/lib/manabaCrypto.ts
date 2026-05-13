// manaba 用のパスワード暗号化。
//
// 仕様:
//   - AES-256-GCM
//   - 鍵: 優先 CREDENTIAL_ENCRYPTION_KEY (32文字以上)、未設定なら
//         従来通り SESSION_SECRET 派生(後方互換)。
//         CREDENTIAL_ENCRYPTION_KEY を別途設定すると Cookie 鍵
//         (SESSION_SECRET) 漏えい時にも認証情報暗号化までは漏れない。
//   - 出力: base64url で `iv.ciphertext.authTag` を `:` 連結
//   - 鍵をローテートすると既存の暗号文は復号不能になる
//     (その場合はユーザに再入力してもらう運用)

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { deriveCredentialKey } from "@/lib/credentialKey";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function key(): Buffer {
  return deriveCredentialKey("manaba", () => {
    // 後方互換: 既存の暗号文を読めるように、SESSION_SECRET から
    // 旧来通り(domain prefix なし)で鍵を導出する。
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[security] CREDENTIAL_ENCRYPTION_KEY または SESSION_SECRET を 32文字以上で設定してください",
        );
      }
      return createHash("sha256")
        .update("dev-only-fallback-for-manaba-crypto")
        .digest();
    }
    return createHash("sha256").update(s).digest();
  });
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
