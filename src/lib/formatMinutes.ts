/** 分数を「1 日 2 時間 30 分」のように表示する。通知文と設定画面の両方で使う。 */
export function formatMinutes(min: number): string {
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [d && `${d} 日`, h && `${h} 時間`, m && `${m} 分`].filter(Boolean);
  return parts.length ? parts.join(" ") : "0 分";
}
