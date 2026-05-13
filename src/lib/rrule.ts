// 繰り返しテンプレート用の RRULE 評価ヘルパー。
//
// RFC 5545 RRULE は機能豊富だが、本アプリで UI から扱うのは以下のみ:
//   - FREQ=DAILY                          毎日
//   - FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR    指定曜日(複数可)
//   - FREQ=MONTHLY;BYMONTHDAY=15          毎月 N 日
//
// expandTodayRecurring 側はこれを呼ぶだけ。判定は YMD(JST)単位で行う。

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export type Recurrence =
  | { kind: "DAILY" }
  | { kind: "WEEKLY"; days: number[] } // 0=Sun, 1=Mon, ..., 6=Sat (JS Date.getDay()準拠)
  | { kind: "MONTHLY"; day: number } // 1..31
  | { kind: "UNKNOWN"; raw: string };

/** "FREQ=WEEKLY;BYDAY=MO,WE,FR" を構造化。 */
export function parseRrule(rrule: string | null | undefined): Recurrence | null {
  if (!rrule) return null;
  const trimmed = rrule.trim();
  if (!trimmed) return null;
  const parts = new Map<string, string>();
  for (const seg of trimmed.split(";")) {
    const [k, v] = seg.split("=");
    if (!k || v === undefined) continue;
    parts.set(k.toUpperCase().trim(), v.trim());
  }
  const freq = parts.get("FREQ");
  if (freq === "DAILY") return { kind: "DAILY" };
  if (freq === "WEEKLY") {
    const byday = parts.get("BYDAY") ?? "";
    const days = byday
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .map((d) => WEEKDAY_CODES.indexOf(d as (typeof WEEKDAY_CODES)[number]))
      .filter((i) => i >= 0);
    return { kind: "WEEKLY", days };
  }
  if (freq === "MONTHLY") {
    const day = Number(parts.get("BYMONTHDAY") ?? "");
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      return { kind: "MONTHLY", day };
    }
  }
  return { kind: "UNKNOWN", raw: trimmed };
}

/** 構造化→RRULE 文字列。UI で組み立てた値を保存する用。 */
export function buildRrule(rec: Recurrence): string {
  switch (rec.kind) {
    case "DAILY":
      return "FREQ=DAILY";
    case "WEEKLY":
      return `FREQ=WEEKLY;BYDAY=${rec.days
        .filter((d) => d >= 0 && d <= 6)
        .sort()
        .map((d) => WEEKDAY_CODES[d])
        .join(",")}`;
    case "MONTHLY":
      return `FREQ=MONTHLY;BYMONTHDAY=${rec.day}`;
    case "UNKNOWN":
      return rec.raw;
  }
}

/** その YMD(JST)が rrule にマッチするか判定。
 *  ymd: "YYYY-MM-DD" (JST)
 */
export function matchesOn(rrule: string | null | undefined, ymd: string): boolean {
  const rec = parseRrule(rrule);
  if (!rec) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  // JST の Date を UTC で表現(時刻 0:00 JST = 前日 15:00 UTC)
  // getDay は LOCAL 依存。サーバが UTC TZ で動く前提で、(年, 月, 日) を
  // UTC ベースで作り、その曜日を見る。UTC 0:00 と JST 0:00 は曜日が
  // 一致するので問題ない(0:00 JST = 前日 15:00 UTC、同じ "暦日" の曜日)。
  // ただし getUTCDay() を使うこと(getDay() は環境依存)。
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  switch (rec.kind) {
    case "DAILY":
      return true;
    case "WEEKLY":
      return rec.days.includes(dow);
    case "MONTHLY":
      return d === rec.day;
    case "UNKNOWN":
      return false;
  }
}

/** UI 表示用ラベル(例: "毎日", "毎週 月水金", "毎月 15日") */
export function rruleLabel(rrule: string | null | undefined): string {
  const rec = parseRrule(rrule);
  if (!rec) return "繰り返しなし";
  const DOW_JA = ["日", "月", "火", "水", "木", "金", "土"];
  switch (rec.kind) {
    case "DAILY":
      return "毎日";
    case "WEEKLY":
      if (rec.days.length === 0) return "毎週(曜日未設定)";
      if (rec.days.length === 7) return "毎日";
      return `毎週 ${rec.days
        .slice()
        .sort()
        .map((d) => DOW_JA[d])
        .join("")}`;
    case "MONTHLY":
      return `毎月 ${rec.day}日`;
    case "UNKNOWN":
      return `カスタム: ${rec.raw}`;
  }
}
