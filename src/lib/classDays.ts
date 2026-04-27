// AcademicEvent から「この日は授業日?」を計算する。
//
// 判定ルール:
//   1. 学期境界(前期授業開始〜前期授業終了 / 後期授業開始〜後期授業終了)内であること
//   2. 日曜は授業日でない(土曜は CIT では授業日扱いなので含める)
//   3. HOLIDAY kind の AcademicEvent がある日は授業日でない(休講)
//   4. 「祭典 / 詣行脚 / 津田沼祭」を含むイベントがある日は授業日でない
//   5. ただし title が「祝日授業日」の日は上記を上書きして授業日(祝日でも授業)
//
// 学期境界は title に「前期授業開始」「前期授業終了」「後期授業開始」「後期授業終了」を
// 含む AcademicEvent の date を使う。見つからない学期は対象外(その期間は class day=false)。

import { prisma } from "@/lib/db";

const NON_CLASS_KEYWORDS = ["祭典", "詣行脚", "津田沼祭"];

type Boundary = { start?: Date; end?: Date };

/**
 * 指定範囲の各日について、授業日かどうかを Map で返す。
 * キーは "YYYY-MM-DD"(JST 文脈)。
 */
export async function computeClassDayMap(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, boolean>> {
  const from = new Date(fromYmd + "T00:00:00+09:00");
  const to = new Date(toYmd + "T23:59:59+09:00");

  // 学期境界は範囲外にもあり得るので、AcademicEvent 全件から探す
  // (毎月クエリで全件は重いが、AcademicEvent は元々年数十件規模なので許容)
  const allEvents = await prisma.academicEvent.findMany({
    select: { date: true, title: true, kind: true },
  });

  // 境界を抽出
  const firstSemester: Boundary = {};
  const secondSemester: Boundary = {};
  for (const e of allEvents) {
    if (e.title.includes("前期授業開始")) firstSemester.start = e.date;
    else if (e.title.includes("前期授業終了")) firstSemester.end = e.date;
    else if (e.title.includes("後期授業開始")) secondSemester.start = e.date;
    else if (e.title.includes("後期授業終了")) secondSemester.end = e.date;
  }

  // 範囲内のイベントだけ拾って日別に集計
  type DayInfo = {
    hasHoliday: boolean;
    hasNonClassEvent: boolean;
    isExplicitClassDay: boolean; // 祝日授業日
  };
  const byYmd = new Map<string, DayInfo>();

  for (const e of allEvents) {
    if (e.date < from || e.date > to) continue;
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

  // 境界内の各日について判定
  const result: Record<string, boolean> = {};
  for (let d = new Date(from); d <= to; d = addOneDay(d)) {
    const ymd = jstYmd(d);
    const info = byYmd.get(ymd);

    // 祝日授業日は最優先で授業日
    if (info?.isExplicitClassDay) {
      result[ymd] = true;
      continue;
    }

    // 学期内チェック
    const inFirst =
      firstSemester.start &&
      firstSemester.end &&
      d >= firstSemester.start &&
      d <= firstSemester.end;
    const inSecond =
      secondSemester.start &&
      secondSemester.end &&
      d >= secondSemester.start &&
      d <= secondSemester.end;
    if (!inFirst && !inSecond) {
      result[ymd] = false;
      continue;
    }

    // JST の曜日(toLocaleString に頼らず、UTC + 9h で計算)
    const jstDow = new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
    if (jstDow === 0) {
      // 日曜
      result[ymd] = false;
      continue;
    }

    // 休講 / 特別行事で潰れている
    if (info?.hasHoliday || info?.hasNonClassEvent) {
      result[ymd] = false;
      continue;
    }

    result[ymd] = true;
  }

  return result;
}

function jstYmd(d: Date): string {
  // d が UTC instant でも JST y/m/d を取り出す
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j.toISOString().slice(0, 10);
}

function addOneDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}
