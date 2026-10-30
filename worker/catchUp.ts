// 定期同期(manaba / CIT ポータル)の取りこぼし判定。
// node-cron は Mac のスリープや Docker 停止で時刻を過ぎた実行をやり直さない。
// 2026-10 に 13:00 の同期がスリープで丸ごと抜け、それ以前にも 2 日近く
// 同期が止まっていたので、worker が定期的に「直近の予定時刻より後に同期
// できているか」を確かめて、できていなければその場で同期する。

// 同期の予定時刻(JST の時)。worker/index.ts の cron 式と揃えること。
export const SYNC_HOURS_JST = [4, 13, 19] as const;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** now 以前で最も新しい同期予定時刻(JST の 4:00 / 13:00 / 19:00)を返す。 */
export function latestSyncSlot(now: Date): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const dayStartUtc =
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS;
  for (const h of [...SYNC_HOURS_JST].reverse()) {
    const slot = dayStartUtc + h * 60 * 60 * 1000;
    if (slot <= now.getTime()) return new Date(slot);
  }
  // 当日の 4:00 より前 → 前日の最後の予定時刻
  const last = SYNC_HOURS_JST[SYNC_HOURS_JST.length - 1];
  return new Date(dayStartUtc - DAY_MS + last * 60 * 60 * 1000);
}

export type LastSync = { manaba: string | null; citPortal: string | null };

/**
 * 予定時刻 slot より後に同期できていないものを返す。
 * null は未連携(または一度も成功していない)なので対象外にする。
 * 一度も成功していない連携を毎回叩くと、壊れた認証情報で大学の SSO に
 * ログインを繰り返すことになるため。
 */
export function staleTargets(slot: Date, last: LastSync): { manaba: boolean; citPortal: boolean } {
  const behind = (v: string | null) => v !== null && new Date(v).getTime() < slot.getTime();
  return { manaba: behind(last.manaba), citPortal: behind(last.citPortal) };
}
