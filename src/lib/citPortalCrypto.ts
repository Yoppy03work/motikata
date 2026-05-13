// CITポータル(Universal Passport RX)用の認証情報暗号化。
// パスワードと TOTP シークレットの両方をこの関数で暗号化する。
//
// 仕様:
//   - AES-256-GCM
//   - 鍵: 優先 CREDENTIAL_ENCRYPTION_KEY (32文字以上)、未設定なら
//         従来通り SESSION_SECRET 派生(domain="cit-portal" で分離)。
//         CREDENTIAL_ENCRYPTION_KEY を別途設定すると Cookie 鍵
//         (SESSION_SECRET) 漏えい時にも認証情報暗号化までは漏れない。
//   - manabaCrypto と鍵を分けるため、新旧どちらの導出経路でも
//     ドメイン分離文字列 "cit-portal" を頭につける。
//   - 出力: base64url で `iv.ciphertext.authTag` を `:` 連結
//   - 鍵をローテートすると既存の暗号文は復号不能になる
//
// 注意:
//   passwordEnc と totpSecretEnc は同じ鍵で暗号化される。
//   DB と 鍵が同時に漏洩した場合 MFA 保護は実質失われる。

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { deriveCredentialKey } from "@/lib/credentialKey";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const DOMAIN = "cit-portal";

function key(): Buffer {
  return deriveCredentialKey(DOMAIN, () => {
    // 後方互換: SESSION_SECRET 派生 (DOMAIN プレフィックスあり)
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[security] CREDENTIAL_ENCRYPTION_KEY または SESSION_SECRET を 32文字以上で設定してください",
        );
      }
      return createHash("sha256")
        .update(`${DOMAIN}:dev-only-fallback-for-cit-portal-crypto`)
        .digest();
    }
    return createHash("sha256").update(`${DOMAIN}:${s}`).digest();
  });
}

function encrypt(plain: string): string {
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

function decrypt(encoded: string): string {
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

export const encryptCitPortalPassword = encrypt;
export const decryptCitPortalPassword = decrypt;
export const encryptCitPortalTotpSecret = encrypt;
export const decryptCitPortalTotpSecret = decrypt;

// 入力された TOTP シークレットを正規化する。
// otpauth:// URI 全体が来た場合は secret パラメータを抽出。
// それ以外は空白除去・大文字化(BASE32 想定)。
export function normalizeTotpSecret(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("otpauth://")) {
    try {
      const url = new URL(trimmed);
      const secret = url.searchParams.get("secret");
      if (secret) return secret.replace(/\s+/g, "").toUpperCase();
    } catch {
      // fall-through
    }
  }
  return trimmed.replace(/\s+/g, "").toUpperCase();
}
