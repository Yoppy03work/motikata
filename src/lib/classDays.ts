// 授業日計算 + 永続化 + 読み出し。
//
// 設計方針:
//   - 学期内の各日について「授業日かどうか」を判定し、true の日付一覧を返す
//     pure 関数 (computeClassDaysFromEvents) を提供
//   - インポート時にこの関数で計算した結果を ClassDay テーブルに bulk insert
//   - カレンダー表示は ClassDay テーブルから読み出す (getClassDayMap)
//
// 判定ルール:
//   1. 学期境界(前期/後期 授業開始〜終了)内であること
//   2. 日曜は授業日でない (土曜は CIT では授業日扱い)
//   3. HOLIDAY 種別の AcademicEvent (休講) がある日は授業日でない
//   4. 「祭典 / 詣行脚 / 津田沼祭」を含むイベントがある日は授業日でない
//   5. ただし title === "祝日授業日" の日は上記を上書きして授業日

import { prisma } from "@/lib/db";

const NON_CLASS_KEYWORDS = ["祭典", "詣行脚", "津田沼祭"];

export type ClassDayInputEvent = {
  title: string;
  date: Date;
  kind: "EXAM" | "HOLIDAY" | "EVENT";
};

type Boundary = { start?: Date; end?: Date };

/**
 * 在メモリの events 配列から授業日(JST)の Date 一覧を計算する。
 * Date は JST 0:00 を表す UTC instant(jstDate と同じ慣習)。
 */
export function computeClassDaysFromEvents(events: ClassDayInputEvent[]): Date[] {
  const firstSemester: Boundary = {};
  const secondSemester: Boundary = {};
  for (const e of events) {
    if (e.title.includes("前期授業開始")) firstSemester.start = e.date;
    else if (e.title.includes("前期授業終了")) firstSemester.end = e.date;
    else if (e.title.includes("後期授業開始")) secondSemester.start = e.date;
    else if (e.title.includes("後期授業終了")) secondSemester.end = e.date;
  }

  // 日別に「休講か」「特別行事で潰れているか」「祝日授業日として強制 ON か」を集計
  type DayInfo = {
    hasHoliday: boolean;
    hasNonClassEvent: boolean;
    isExplicitClassDay: boolean;
  };
  const byYmd = new Map<string, DayInfo>();
  for (const e of events) {
    const ymd = jstYmd(e.date);
    const info = byYmd.get(ymd) ?? {
      hasHoliday: false,
      hasNonClassEvent: false,
      isExplicitClassDay: false,
    };
    if (e.kind === "HOLIDAY") info.hasHoliday = true;
    if (NON_CLASS_KEYWORDS.some((k) => e.title.includes(k))) info.hasNonClassEvent = true;
    if (e.title === "祝日授業日") info.isExplicitClassDay = true;
    byYmd.set(ymd, info);
  }

  const result: Date[] = [];
  // どちらかの学期境界が決まっていない場合は、その学期は対象外
  const ranges = [firstSemester, secondSemester].filter(
    (r): r is { start: Date; end: Date } => !!(r.start && r.end),
  );
  for (const r of ranges) {
    for (let d = new Date(r.start); d <= r.end; d = addOneDay(d)) {
      const ymd = jstYmd(d);
      const info = byYmd.get(ymd);

      if (info?.isExplicitClassDay) {
        result.push(jstZero(d));
        continue;
      }

      const jstDow = new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
      if (jstDow === 0) continue; // 日曜
      if (info?.hasHoliday || info?.hasNonClassEvent) continue;

      result.push(jstZero(d));
    }
  }
  return result;
}

/**
 * 範囲 [fromYmd, toYmd] の各日について授業日フラグを返す。
 * ClassDay テーブルから読み出す(=直近のインポートで計算済みのもの)。
 */
export async function getClassDayMap(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, boolean>> {
  const from = new Date(fromYmd + "T00:00:00+09:00");
  const to = new Date(toYmd + "T23:59:59+09:00");
  const rows = await prisma.classDay.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
  });
  const map: Record<string, boolean> = {};
  for (const r of rows) map[jstYmd(r.date)] = true;
  return map;
}

/**
 * 既存の指定範囲 ClassDay を全削除して、与えた dates で置き換える。
 * 学年単位の再インポートを想定。
 */
export async function replaceClassDays(
  rangeStart: Date,
  rangeEnd: Date,
  dates: Date[],
): Promise<{ deleted: number; inserted: number }> {
  return prisma.$transaction(async (tx) => {
    const del = await tx.classDay.deleteMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
    });
    if (dates.length === 0) {
      return { deleted: del.count, inserted: 0 };
    }
    await tx.classDay.createMany({
      data: dates.map((d) => ({ date: d })),
      skipDuplicates: true,
    });
    return { deleted: del.count, inserted: dates.length };
  });
}

function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

// d の JST 日付の 0:00 を表す UTC instant に正規化(時刻成分を捨てる)
function jstZero(d: Date): Date {
  const ymd = jstYmd(d);
  const [y, m, dd] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd, -9, 0, 0));
}

function addOneDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}
