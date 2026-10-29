// 外部サービス認証情報(manaba / CITポータル等)の暗号化鍵を導出する。
//
// 設計:
//   - 優先: CREDENTIAL_ENCRYPTION_KEY (32文字以上) を別途設定する。
//           これがあれば SHA-256(domain + ":" + key) を鍵に使う。
//           SESSION_SECRET と分離されているので、Cookie 鍵漏えい時にも
//           認証情報暗号化までは漏れない。
//   - フォールバック: 未設定(空文字含む)なら従来通り SESSION_SECRET 派生に流す。
//                   既存の暗号文(SESSION_SECRET で暗号化済)はそのまま読める。
//                   本番では 1 度だけ warn を出す(SESSION_SECRET を変えると
//                   保存済み認証情報も復号不能になる結合に気づけるように)。
//   - 設定されているのに 32 文字未満なら例外にする。以前は黙って
//     SESSION_SECRET 派生に落ちていたため、設定したつもりの鍵が使われず
//     「別鍵で分離できている」と誤認する事故が起きえた。
//
// 鍵ローテーション:
//   CREDENTIAL_ENCRYPTION_KEY を新たに設定 or 変更すると、それ以前に
//   保存された認証情報は復号できなくなる(SESSION_SECRET 派生では
//   鍵が違うため)。再入力が必要。
//
//   → 設定画面側で lastError を見て「再入力してください」と表示できる。

import { createHash } from "node:crypto";

const MIN_LEN = 32;

let warnedLegacy = false;

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
  if (credKey) {
    if (credKey.length < MIN_LEN) {
      throw new Error(
        `[security] CREDENTIAL_ENCRYPTION_KEY は ${MIN_LEN} 文字以上で設定してください(未使用なら空にする)`,
      );
    }
    return createHash("sha256").update(`${domain}:${credKey}`).digest();
  }
  if (process.env.NODE_ENV === "production" && !warnedLegacy) {
    warnedLegacy = true;
    console.warn(
      "[security] CREDENTIAL_ENCRYPTION_KEY is not set: credentials are encrypted with a key derived from SESSION_SECRET. Rotating SESSION_SECRET will make saved credentials unreadable.",
    );
  }
  return legacyKey();
}
