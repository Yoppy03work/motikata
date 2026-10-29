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

export type Semester = "first" | "second";

/**
 * 学年度 + 学期の期間(JST 基準)を UTC の Date で返す。
 *   前期 = year/4/1 00:00 JST 〜 year/9/30 23:59:59 JST
 *   後期 = year/10/1 00:00 JST 〜 (year+1)/3/31 23:59:59 JST
 * CIT ポータル同期が保存する effectiveFrom / effectiveTo と同じ値になる。
 */
export function termRange(
  year: number,
  semester: Semester,
): { from: Date; to: Date } {
  // JST は UTC+9 なので、Date.UTC の時を -9 して「JST の 00:00」を作る。
  if (semester === "first") {
    return {
      from: new Date(Date.UTC(year, 3, 1, -9, 0, 0)),
      to: new Date(Date.UTC(year, 9, 0, 14, 59, 59)),
    };
  }
  return {
    from: new Date(Date.UTC(year, 9, 1, -9, 0, 0)),
    to: new Date(Date.UTC(year + 1, 3, 0, 14, 59, 59)),
  };
}
