// Google カレンダーの colorId → hex マッピング。
//
// Google Calendar API は colors.get で公式マッピングを返すが、
// 値が公開仕様として安定しているので静的テーブルでも実害は無い。
// 動的取得を入れる場合は数日キャッシュで OK。
//
// 出典: https://developers.google.com/calendar/api/v3/reference/colors/get
// (calendar.colors と event.colors の 2 セット。calendarListEntry.colorId は
//  calendar.colors を、events[].colorId は event.colors を引く)
//
// 取得できない / 未設定 (id=null) のときは null を返す。呼び出し側で
// 「Google default = ソース別 fallback 色」を使う想定。

// calendar.colors テーブル (calendarListEntry.colorId 用)
const CALENDAR_COLORS: Record<string, string> = {
  "1": "#ac725e", // Cocoa
  "2": "#d06b64", // Flamingo
  "3": "#f83a22", // Tomato
  "4": "#fa573c", // Tangerine
  "5": "#ff7537", // Pumpkin
  "6": "#ffad46", // Mango
  "7": "#42d692", // Eucalyptus
  "8": "#16a765", // Basil
  "9": "#7bd148", // Pistachio
  "10": "#b3dc6c", // Avocado
  "11": "#fbe983", // Citron
  "12": "#fad165", // Banana
  "13": "#92e1c0", // Sage
  "14": "#9fe1e7", // Peacock
  "15": "#9fc6e7", // Cobalt
  "16": "#4986e7", // Blueberry
  "17": "#9a9cff", // Lavender
  "18": "#b99aff", // Wisteria
  "19": "#c2c2c2", // Graphite
  "20": "#cabdbf", // Birch
  "21": "#cca6ac", // Radicchio
  "22": "#f691b2", // Cherry blossom
  "23": "#cd74e6", // Grape
  "24": "#a47ae2", // Amethyst
};

// event.colors テーブル (events[].colorId 用)
const EVENT_COLORS: Record<string, string> = {
  "1": "#a4bdfc", // Lavender
  "2": "#7ae7bf", // Sage
  "3": "#dbadff", // Grape
  "4": "#ff887c", // Flamingo
  "5": "#fbd75b", // Banana
  "6": "#ffb878", // Tangerine
  "7": "#46d6db", // Peacock
  "8": "#e1e1e1", // Graphite
  "9": "#5484ed", // Blueberry
  "10": "#51b749", // Basil
  "11": "#dc2127", // Tomato
};

export function resolveGoogleCalendarColor(colorId: string | null | undefined): string | null {
  if (!colorId) return null;
  return CALENDAR_COLORS[colorId] ?? null;
}

export function resolveGoogleEventColor(colorId: string | null | undefined): string | null {
  if (!colorId) return null;
  return EVENT_COLORS[colorId] ?? null;
}
