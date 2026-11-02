/**
 * auto 出席の段階解禁フラグ (fail-closed)
 *
 * ChibaTechPortal から clean copy (2026-11-02)。モチカタは単一ユーザーなので allowlist は
 * 単純な master switch に簡約。
 *
 * WHY: auto 実送信は最高リスク。env で dark default にし、dry-run → 実送信 の段階で解禁する。
 * 解禁の判断は env のみ (コード変更不要)。何も設定しなければ auto は走らない。
 */

/** auto 実送信のマスターキルスイッチ。true のときのみ auto 経路が生きる。 */
export function isAutoExecutionEnabled(): boolean {
  return process.env.ATTENDANCE_AUTO_EXECUTION_ENABLED === "true";
}

/**
 * dry-run か。true のとき全 guard を通すが adapter.attend() は実行せず (no-op + 監査ログ)、
 * 外部送信なしで経路全体を検証する。
 *
 * WHY (fail-toward-dry-run): 安全側 = 送らない方向に倒す。typo しても実送信にならないよう、
 * 空でも 'false'/'0'/'no' でもない値は全て dry-run 扱い。実送信は未設定 or 明示 false/0/no。
 */
export function isAutoDryRun(): boolean {
  const v = (process.env.ATTENDANCE_AUTO_DRY_RUN ?? "").trim().toLowerCase();
  return v !== "" && v !== "false" && v !== "0" && v !== "no";
}
