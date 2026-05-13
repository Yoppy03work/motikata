// 外部サービス認証情報(manaba / CITポータル等)の暗号化鍵を導出する。
//
// 設計:
//   - 優先: CREDENTIAL_ENCRYPTION_KEY (32文字以上) を別途設定する。
//           これがあれば SHA-256(domain + ":" + key) を鍵に使う。
//           SESSION_SECRET と分離されているので、Cookie 鍵漏えい時にも
//           認証情報暗号化までは漏れない。
//   - フォールバック: 未設定なら従来通り SESSION_SECRET 派生に流す。
//                   既存の暗号文(SESSION_SECRET で暗号化済)はそのまま読める。
//
// 鍵ローテーション:
//   CREDENTIAL_ENCRYPTION_KEY を新たに設定 or 変更すると、それ以前に
//   保存された認証情報は復号できなくなる(SESSION_SECRET 派生では
//   鍵が違うため)。再入力が必要。
//
//   → 設定画面側で lastError を見て「再入力してください」と表示できる。

import { createHash } from "node:crypto";

const MIN_LEN = 32;

/**
 * 認証情報暗号化用の 32byte 鍵を返す。
 * @param domain ドメイン分離文字列 (例: "manaba", "cit-portal")
 * @param legacyKey CREDENTIAL_ENCRYPTION_KEY 未設定時のフォールバック関数。
 *                  各モジュールが従来の SESSION_SECRET 派生ロジックを渡す
 *                  ことで、既存の暗号文を読み続けられる。
 */
export function deriveCredentialKey(
  domain: string,
  legacyKey: () => Buffer,
): Buffer {
  const credKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (credKey && credKey.length >= MIN_LEN) {
    return createHash("sha256").update(`${domain}:${credKey}`).digest();
  }
  return legacyKey();
}
