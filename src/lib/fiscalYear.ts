// 学年度(4月始まり)の計算。DB の日時は UTC なので JST に寄せてから月を見る。
// 例: 2026-03-31T15:00Z (= 2026-04-01 JST) → 2026、2027-03-31 JST → 2026。
// DB に依存しないので Client Component からも import してよい。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function fiscalYearOf(date: Date): number {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  return jst.getUTCMonth() + 1 >= 4 ? year : year - 1;
}

export function currentFiscalYear(now: Date = new Date()): number {
  return fiscalYearOf(now);
}
