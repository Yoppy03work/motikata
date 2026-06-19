// ICS テキストから VEVENT を抽出して AcademicEvent に流し込める形に正規化する。
// タイトルのキーワードから kind(EXAM/HOLIDAY/EVENT)を簡易分類。

import ICAL from "ical.js";

export type AcademicKindGuess = "EXAM" | "HOLIDAY" | "EVENT";

export type ParsedAcademicEvent = {
  title: string;
  date: Date; // JST 日付の 0:00 に正規化(時刻情報は捨てる)
  kind: AcademicKindGuess;
  uid: string | null; // ICS の UID(将来の dedupe 用)
};

const EXAM_KEYWORDS = ["試験", "テスト", "exam", "examination", "中間", "期末", "クォーター", "考査"];
const HOLIDAY_KEYWORDS = ["休講", "休日", "祝", "休業", "休み", "holiday", "no class", "closed"];

function classify(title: string): AcademicKindGuess {
  const lower = title.toLowerCase();
  if (EXAM_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return "EXAM";
  if (HOLIDAY_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return "HOLIDAY";
  return "EVENT";
}

/**
 * ical.js の Time オブジェクトから JST の 00:00 Date を作る。
 * - all-day (DATE) の場合: そのままその日付の JST 0:00
 * - 時刻付き (DATE-TIME) の場合: JST に変換した日の 0:00 に丸める
 */
function toJstMidnight(t: ICAL.Time): Date {
  // ical.js Time → JS Date は toJSDate() (UTC 基準の Date)
  const jsDate = t.toJSDate();
  // UTC ミリ秒に +9h を足して JST の y/m/d を取り出す
  const jstMs = jsDate.getTime() + 9 * 3600 * 1000;
  const j = new Date(jstMs);
  // JST の y/m/d を「UTC で同じ y/m/d の 0:00」として作る(DB は UTC 保存だが、
  // JST 0:00 == UTC 15:00 前日。表示時は formatInTimeZone で JST 戻し)
  // ここは「日付そのもの」として扱いたいので、JST 0:00 == UTC -9h を Date に。
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), -9, 0, 0));
}

export type ParseResult =
  | { ok: true; events: ParsedAcademicEvent[] }
  | { ok: false; error: string };

export function parseIcs(text: string): ParseResult {
  let comp: ICAL.Component;
  try {
    comp = ICAL.Component.fromString(text);
  } catch (e) {
    return {
      ok: false,
      error: `ICS パース失敗: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const vevents = comp.getAllSubcomponents("vevent");
  const out: ParsedAcademicEvent[] = [];

  for (const ve of vevents) {
    let ev: ICAL.Event;
    try {
      ev = new ICAL.Event(ve);
    } catch {
      continue; // 一部が壊れていても全体を止めない
    }

    const title = (ev.summary ?? "").trim();
    if (!title) continue;
    if (!ev.startDate) continue;

    out.push({
      title: title.slice(0, 200),
      date: toJstMidnight(ev.startDate),
      kind: classify(title),
      uid: ev.uid ?? null,
    });
  }

  // 同日同タイトルの重複は1つにまとめる
  const seen = new Set<string>();
  const dedup: ParsedAcademicEvent[] = [];
  for (const e of out) {
    const k = `${e.date.toISOString()}|${e.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(e);
  }

  return { ok: true, events: dedup };
}
