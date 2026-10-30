// 自動同期(manaba / CIT ポータル)が止まっていないかの判定。
// worker は毎日 04:00 / 13:00 / 19:00 JST に同期するので、間隔は最大 9 時間。
// 余裕を見て 12 時間を超えて成功していなければ「止まっている」とみなす。
// DB に依存しないので Client Component からも import してよい。

export const SYNC_STALE_MS = 12 * 60 * 60 * 1000;

/** 未同期(null)は登録直後もありうるので警告しない。 */
export function isSyncStale(
  lastSyncedAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (lastSyncedAt === null) return false;
  const last = typeof lastSyncedAt === "string" ? new Date(lastSyncedAt) : lastSyncedAt;
  if (Number.isNaN(last.getTime())) return false;
  return now.getTime() - last.getTime() > SYNC_STALE_MS;
}
