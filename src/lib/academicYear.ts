// 学年度ユーティリティ。
// 学年度は 4月始まり 〜 翌3月終わり。月から学年度を逆算する。

export function academicYearOf(date: Date, tz = "Asia/Tokyo"): number {
  // JST の年/月を取り出す
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
  });
  const parts = fmt.formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  if (!y || !m) return new Date().getFullYear();
  return m >= 4 ? y : y - 1;
}
