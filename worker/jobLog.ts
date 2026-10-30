import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

// job の実行結果を 1 行ずつファイルに残す。
// docker のログはコンテナを作り直すと消えるので、2026-10 に manaba 同期が
// 2 日近く止まったとき原因を追えなかった。JOB_LOG_DIR を volume に向けておけば
// 作り直しても残る。未設定なら何もしない(ローカル開発は console だけで足りる)。
//
// ローテーション: MAX_BYTES を超えたら jobs.log → jobs.log.1 に退避(1 世代)。

const MAX_BYTES = 1024 * 1024;

export function appendJobLog(
  label: string,
  outcome: "ok" | "failed" | "error" | "timeout",
  detail = "",
  dir: string | undefined = process.env.JOB_LOG_DIR,
  now: Date = new Date(),
): void {
  if (!dir) return;
  const file = path.join(dir, "jobs.log");
  // 改行を潰して 1 job = 1 行を保つ
  const line = `${now.toISOString()} ${label} ${outcome}${detail ? " " + detail.replace(/\s+/g, " ").slice(0, 300) : ""}\n`;
  try {
    mkdirSync(dir, { recursive: true });
    try {
      if (statSync(file).size >= MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      // まだファイルが無い
    }
    appendFileSync(file, line);
  } catch (e) {
    // ログ書き込みの失敗で job を止めない
    console.error("[worker] job log write failed:", e instanceof Error ? e.message : e);
  }
}
