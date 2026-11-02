// 通知先(Slack / Discord の webhook URL、LINE のトークン)と VAPID 秘密鍵の暗号化。
// 方式は citPortalCrypto と同じ AES-256-GCM。鍵はドメイン "notify" で分離する。

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { deriveCredentialKey } from "@/lib/credentialKey";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const DOMAIN = "notify";

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
        .update(`${DOMAIN}:dev-only-fallback-for-notify-crypto`)
        .digest();
    }
    return createHash("sha256").update(`${DOMAIN}:${s}`).digest();
  });
}

export function encryptNotifySecret(plain: string): string {
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

export function decryptNotifySecret(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("invalid ciphertext format");
  const [ivB, ctB, tagB] = parts;
  const iv = Buffer.from(ivB, "base64url");
  const ct = Buffer.from(ctB, "base64url");
  const tag = Buffer.from(tagB, "base64url");
  if (iv.length !== IV_LEN) throw new Error("invalid iv length");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
