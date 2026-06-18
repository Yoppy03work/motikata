import { prisma } from "./db";
import { getClassDayMap } from "./classDays";
import type { DayIndicators, MonthEvent } from "@/components/MonthCalendar";

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
    // Asia/Tokyo日に丸める
    const jst = new Date(r.dueAt.getTime() + 9 * 60 * 60 * 1000);
    const ymd = jst.toISOString().slice(0, 10);
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
): Promise<Record<string, MonthEvent[]>> {
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

  const map: Record<string, MonthEvent[]> = {};
  for (const r of rows) {
    const jst = new Date(r.dueAt.getTime() + 9 * 60 * 60 * 1000);
    const ymd = jst.toISOString().slice(0, 10);
    const kind: MonthEvent["kind"] =
      r.itemType === "EVENT" ? "event" : r.required ? "required" : "optional";
    (map[ymd] ||= []).push({ id: r.id, title: r.title, kind });
  }
  for (const ymd of Object.keys(map)) {
    map[ymd].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
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
