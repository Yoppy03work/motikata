// DB に依存しない YYYY-MM-DD ユーティリティ。Client Component からも import できる。

/** YYYY-MM-DD 妥当性チェック(API 引数用)。
 *  正規表現だけでなく、実在する暦の日付かまでチェックする。
 *  例えば "2026-13-40" や "2025-02-30" は false。
 *  これを通った文字列を new Date(`${ymd}T00:00:00+09:00`) に渡しても
 *  Invalid Date にならない。 */
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  // 月/日のオーバーフロー検出: UTC で組み立てて round-trip 比較する。
  // 例: "2025-02-30" → Date(2025,1,30) が「3/2」に正規化されて月/日が一致しない。
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}
