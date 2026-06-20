import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { getClassDayMap } from "./classDays";
import { APP_TZ } from "./tz";
import { MAX_BARS_PER_CELL } from "./calendarConstants";
import type {
  DayIndicators,
  MonthEvent,
  MonthEventDay,
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

  // Phase 14a: multi-day overlap も拾う (getMonthlyEvents と同じ where)。
  const [rows, classDayMap] = await Promise.all([
    prisma.taskInstance.findMany({
      where: {
        AND: [
          { dueAt: { lte: to } },
          {
            OR: [
              // Phase 14a.1: endAt > from で strict 比較 (all-day exclusive)。
              // endAt NULL や反転データは dueAt overlap で拾う。
              { endAt: { gt: from } },
              { dueAt: { gte: from } },
            ],
          },
        ],
      },
      select: {
        dueAt: true,
        endAt: true,
        itemType: true,
        required: true,
        status: true,
      },
    }),
    getClassDayMap(fromYmd, toYmd),
  ]);

  const map: Record<string, DayIndicators> = {};
  // タスクの集計。
  // DayDetailSheet 側は DONE / SKIPPED 両方を「終わった項目」として
  // メインバケットから外しているので、月インジケータも同じ扱いにする。
  // ここで OPEN だけカウントすれば、月ビューと日詳細でドット表示の有無が
  // ズレることを防げる。
  // Phase 14a: multi-day event は各日に counter を加算する (getMonthlyEvents と
  // 同じ展開ロジック)。endAt は exclusive 解釈で end 当日を含めない。
  for (const r of rows) {
    if (r.status !== "OPEN") continue;
    const incrementBucket = (ymd: string) => {
      const bucket = (map[ymd] ||= { events: 0, required: 0, optional: 0 });
      if (r.itemType === "EVENT") bucket.events = (bucket.events ?? 0) + 1;
      else if (r.required) bucket.required = (bucket.required ?? 0) + 1;
      else bucket.optional = (bucket.optional ?? 0) + 1;
    };
    if (r.endAt && r.endAt.getTime() > r.dueAt.getTime()) {
      const winStartMs = from.getTime();
      const winEndMs = to.getTime();
      const stopExclusive = Math.min(r.endAt.getTime(), winEndMs + 1);
      let cursor = Math.max(r.dueAt.getTime(), winStartMs);
      while (cursor < stopExclusive) {
        const ymd = ymdInAppTz(new Date(cursor));
        incrementBucket(ymd);
        const jstNext = new Date(`${ymd}T00:00:00+09:00`);
        cursor = jstNext.getTime() + 24 * 60 * 60 * 1000;
      }
    } else {
      incrementBucket(ymdInAppTz(r.dueAt));
    }
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

  // Phase 14a: range query を multi-day overlap に拡張。
  // window [from, to] と event 期間 [dueAt, endAt or dueAt] が重なる行を全部拾う。
  // endAt が NULL (= 単点 event, Phase 13 以前の通常 event) なら dueAt が
  // window 内に入っていれば良いので、Prisma の where OR で表現する。
  // 重なり判定: event.start <= window.to AND (event.end >= window.from OR event.end NULL && event.start >= window.from)
  const rows = await prisma.taskInstance.findMany({
    where: {
      status: "OPEN",
      AND: [
        { dueAt: { lte: to } }, // 開始が window 終わりより前
        {
          OR: [
            { endAt: { gte: from } }, // 終了が window 開始より後 (multi-day overlap)
            { AND: [{ endAt: null }, { dueAt: { gte: from } }] }, // 単点 event
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      endAt: true,
      isAllDay: true,
      itemType: true,
      required: true,
      // Phase 2: Google カレンダー由来の予定はカレンダー固有色 (hex) を持つ。
      // null なら描画側で kind ベース fallback。
      color: true,
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
  });

  // 一旦全件 map に積み、kind 優先度で並べ直してから MAX_BARS_PER_CELL で
  // 切り詰める。サーバー側で先にカットすることで RSC payload を抑え、
  // 1日 50件のような病的ユーザーでも 50 件 title が乗らない。
  // 切り捨てた残数は hidden に保持して「+N 件」表示の精度を維持。
  //
  // Phase 14a: multi-day event は window 内で重なる全日に展開して入れる。
  // 例: 6/19-6/21 all-day → 6/19, 6/20, 6/21 の 3 日それぞれの bucket に登録。
  // all-day / timed どちらも endAt は exclusive 解釈で end 当日を含めない
  // (all-day: Google 仕様; timed: end 時刻 ≤ 00:00 ならその日は表示しない)。
  // Phase 14a.1: multi-day event を「開始日」と「継続日」で startIso を分ける。
  //   - 開始日: startIso = r.dueAt (バー描画で "HH:mm タイトル" になる)
  //   - 継続日 (2 日目以降): startIso = null (時刻 prefix なしで "タイトル" だけ)
  //   これで multi-day timed event の day 2/3 に誤った開始時刻が出ない。
  const buckets: Record<string, MonthEvent[]> = {};
  const startYmd = (r: { dueAt: Date }) => ymdInAppTz(r.dueAt);
  for (const r of rows) {
    const kind: MonthEvent["kind"] =
      r.itemType === "EVENT" ? "event" : r.required ? "required" : "optional";
    const baseStartIso = r.dueAt.toISOString();
    const baseDayYmd = startYmd(r);
    const makeEv = (forYmd: string): MonthEvent => ({
      id: r.id,
      title: r.title,
      kind,
      color: r.color,
      isAllDay: r.isAllDay,
      // 開始日のみ startIso を持つ。継続日は null で時刻 prefix を抑制。
      startIso: forYmd === baseDayYmd ? baseStartIso : null,
    });
    if (r.endAt && r.endAt.getTime() > r.dueAt.getTime()) {
      const startMs = r.dueAt.getTime();
      const endMs = r.endAt.getTime();
      const winStartMs = from.getTime();
      const winEndMs = to.getTime();
      let cursor = Math.max(startMs, winStartMs);
      const stopExclusive = Math.min(endMs, winEndMs + 1);
      while (cursor < stopExclusive) {
        const ymd = ymdInAppTz(new Date(cursor));
        (buckets[ymd] ||= []).push(makeEv(ymd));
        const jstNext = new Date(`${ymd}T00:00:00+09:00`);
        cursor = jstNext.getTime() + 24 * 60 * 60 * 1000;
      }
    } else {
      const ymd = ymdInAppTz(r.dueAt);
      (buckets[ymd] ||= []).push(makeEv(ymd));
    }
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
