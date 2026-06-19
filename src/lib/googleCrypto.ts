// Google カレンダー連携用の OAuth refresh_token 暗号化。
//
// 仕様:
//   - AES-256-GCM (manaba / CITポータル と同じ実装)
//   - 鍵: deriveCredentialKey(domain="google-calendar"). 優先 CREDENTIAL_ENCRYPTION_KEY,
//         未設定なら SESSION_SECRET 派生 (domain="google-calendar" でドメイン分離)
//   - 出力: base64url で `iv.ciphertext.authTag` を `:` 連結
//   - 鍵をローテートすると既存の暗号文は復号不能になる → 設定 UI で再連携を促す
//
// 注意:
//   refresh_token は Google API への永続認可なので、漏洩時は影響大。
//   AES-256-GCM の認証付き暗号で改ざんも検知できる。

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { deriveCredentialKey } from "@/lib/credentialKey";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const DOMAIN = "google-calendar";

function key(): Buffer {
  return deriveCredentialKey(DOMAIN, () => {
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[security] CREDENTIAL_ENCRYPTION_KEY または SESSION_SECRET を 32文字以上で設定してください",
        );
      }
      return createHash("sha256")
        .update(`${DOMAIN}:dev-only-fallback-for-google-crypto`)
        .digest();
    }
    return createHash("sha256").update(`${DOMAIN}:${s}`).digest();
  });
}

export function encryptGoogleRefreshToken(plain: string): string {
  if (!plain) throw new Error("empty plaintext");
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

export function decryptGoogleRefreshToken(encoded: string): string {
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
