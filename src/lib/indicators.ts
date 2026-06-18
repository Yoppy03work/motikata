import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { getClassDayMap } from "./classDays";
import { APP_TZ } from "./tz";
import {
  MAX_BARS_PER_CELL,
  type DayIndicators,
  type MonthEvent,
  type MonthEventDay,
} from "@/components/MonthCalendar";

// DateTime → "YYYY-MM-DD" を APP_TZ ベースで返す。
// 手書きの "Date.getTime() + 9h → toISOString().slice(0,10)" は JST が
// DST を持たないため今は動くが、プロジェクト規約 (today/page.tsx,
// dispatchReminders.ts など) は formatInTimeZone を使っており、ここだけ
// 例外にしておく合理性が無い。将来 APP_TZ を DST のある TZ に振り替えた
// 際の事故を避けるため揃える。
function ymdInAppTz(d: Date): string {
  return formatInTimeZone(d, APP_TZ, "yyyy-MM-dd");
}

export async function getMonthlyIndicators(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, DayIndicators>> {
  const from = new Date(fromYmd + "T00:00:00+09:00");
  const to = new Date(toYmd + "T23:59:59+09:00");

  const [rows, classDayMap] = await Promise.all([
    prisma.taskInstance.findMany({
      where: { dueAt: { gte: from, lte: to } },
      select: { dueAt: true, itemType: true, required: true, status: true },
    }),
    getClassDayMap(fromYmd, toYmd),
  ]);

  const map: Record<string, DayIndicators> = {};
  // タスクの集計。
  // DayDetailSheet 側は DONE / SKIPPED 両方を「終わった項目」として
  // メインバケットから外しているので、月インジケータも同じ扱いにする。
  // ここで OPEN だけカウントすれば、月ビューと日詳細でドット表示の有無が
  // ズレることを防げる。
  for (const r of rows) {
    if (r.status !== "OPEN") continue;
    const ymd = ymdInAppTz(r.dueAt);
    const bucket = (map[ymd] ||= { events: 0, required: 0, optional: 0 });
    if (r.itemType === "EVENT") bucket.events = (bucket.events ?? 0) + 1;
    else if (r.required) bucket.required = (bucket.required ?? 0) + 1;
    else bucket.optional = (bucket.optional ?? 0) + 1;
  }
  // 授業日フラグを混ぜる(タスクが無い日にも色を付けたいので、map にエントリを作る)
  for (const [ymd, isClass] of Object.entries(classDayMap)) {
    if (!isClass) continue;
    const bucket = (map[ymd] ||= { events: 0, required: 0, optional: 0 });
    bucket.isClassDay = true;
  }
  return map;
}

// /calendar の Google カレンダー風表示用。
// 各日の OPEN な TaskInstance を時刻順に並べ、title 付きで返す。
// indicators との違い: 件数ではなく実体(id/title/kind)を渡したいので別関数。
// 範囲は wide range(±12 ヶ月)で呼ばれる想定だが、status=OPEN フィルタが効くので
// 多くてもユーザー1人で数百件オーダー。
//
// セルに並べきれずクリップされる際の優先順位:
// 1. event(時間拘束のある予定) を最優先
// 2. required(必須タスク)
// 3. optional(任意タスク)
// 同じ kind 内は dueAt 昇順(prisma orderBy + V8 stable sort で維持)。
// 朝のタスクが先に並んで午後の授業が「+1 件」に押し出される事故を防ぐ。
const KIND_PRIORITY: Record<MonthEvent["kind"], number> = {
  event: 0,
  required: 1,
  optional: 2,
};

export async function getMonthlyEvents(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, MonthEventDay>> {
  const from = new Date(fromYmd + "T00:00:00+09:00");
  const to = new Date(toYmd + "T23:59:59+09:00");

  const rows = await prisma.taskInstance.findMany({
    where: { dueAt: { gte: from, lte: to }, status: "OPEN" },
    select: {
      id: true,
      title: true,
      dueAt: true,
      itemType: true,
      required: true,
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
  });

  // 一旦全件 map に積み、kind 優先度で並べ直してから MAX_BARS_PER_CELL で
  // 切り詰める。サーバー側で先にカットすることで RSC payload を抑え、
  // 1日 50件のような病的ユーザーでも 50 件 title が乗らない。
  // 切り捨てた残数は hidden に保持して「+N 件」表示の精度を維持。
  const buckets: Record<string, MonthEvent[]> = {};
  for (const r of rows) {
    const ymd = ymdInAppTz(r.dueAt);
    const kind: MonthEvent["kind"] =
      r.itemType === "EVENT" ? "event" : r.required ? "required" : "optional";
    (buckets[ymd] ||= []).push({ id: r.id, title: r.title, kind });
  }
  const map: Record<string, MonthEventDay> = {};
  for (const ymd of Object.keys(buckets)) {
    const sorted = buckets[ymd].sort(
      (a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind],
    );
    map[ymd] = {
      events: sorted.slice(0, MAX_BARS_PER_CELL),
      hidden: Math.max(0, sorted.length - MAX_BARS_PER_CELL),
    };
  }
  return map;
}

export function monthWindow(aroundYmd: string): { from: string; to: string } {
  // 入力 aroundYmd は JST 文脈の "YYYY-MM-DD"。
  // 旧コードは new Date(..+09:00) → getFullYear/getMonth() という local-time
  // ベースで月境界を出していたため、UTC サーバ上では JST 5/1 を読んで
  // local では 4/30 → 3〜5月の window になってしまっていた。
  //
  // ymd 文字列を直接パースして JST 年月を取り出し、月の前後± で範囲を作る。
  const [yStr, mStr] = aroundYmd.split("-");
  const year = Number(yStr);
  const month1 = Number(mStr); // 1..12
  // 前月の 1日 〜 翌月の末日 のレンジ。
  const start = { y: year, m: month1 - 1 };
  while (start.m < 1) {
    start.m += 12;
    start.y -= 1;
  }
  const endMonth = { y: year, m: month1 + 1 };
  while (endMonth.m > 12) {
    endMonth.m -= 12;
    endMonth.y += 1;
  }
  // 翌月の末日 = 翌々月の0日(JS Date 仕様)。これは day=0 で前月の最終日になる
  // 性質を利用する。UTC ベースで計算しても day-of-month はズレないので
  // Date.UTC を使う。
  const endDate = new Date(Date.UTC(endMonth.y, endMonth.m, 0));
  const endDay = endDate.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${start.y}-${pad(start.m)}-01`,
    to: `${endMonth.y}-${pad(endMonth.m)}-${pad(endDay)}`,
  };
}
