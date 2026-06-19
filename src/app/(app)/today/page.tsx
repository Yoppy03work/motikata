import { format } from "date-fns";
import { ja } from "date-fns/locale/ja";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { APP_TZ } from "@/lib/tz";
import { isValidYmd } from "@/lib/week";
import { getMonthlyIndicators, monthWindow } from "@/lib/indicators";
import { getDayItems } from "@/lib/today";
import { CalendarIcon } from "@/components/icons";
import { TodayItemCard } from "./TodayItemCard";
import { DateNav } from "./DateNav";
import { SwipeNav } from "./SwipeNav";
import type { TodayItem } from "./types";

export const dynamic = "force-dynamic";

function ymdJst(d: Date): string {
  return format(toZonedTime(d, APP_TZ), "yyyy-MM-dd");
}

function parseYmd(s: string): Date {
  // Asia/Tokyoの0時として扱う
  return new Date(`${s}T00:00:00+09:00`);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 優先度の並び順(降順)。HIGH が一番上、LOW が下。
const PRIORITY_RANK: Record<TodayItem["priority"], number> = {
  HIGH: 0,
  MID: 1,
  LOW: 2,
};

function comparePriorityThenDue(a: TodayItem, b: TodayItem): number {
  const pa = PRIORITY_RANK[a.priority] ?? 99;
  const pb = PRIORITY_RANK[b.priority] ?? 99;
  if (pa !== pb) return pa - pb;
  return a.dueAt.localeCompare(b.dueAt);
}

function groupByAxis(items: TodayItem[]) {
  // 「open」(現役)は status === "OPEN" のみ。SKIPPED は終わった扱い。
  // (DayDetailSheet / 月インジケータ / 週ビューの未完了カウントと挙動を揃える)
  // done バケットには DONE と SKIPPED の両方を含めて、Today から完全に
  // 見えなくならないようにする(後で見返したり 戻す 操作の入り口になる)。
  const open = items.filter((i) => i.status === "OPEN");
  return {
    // 予定 (EVENT) は時刻順のまま(優先度の概念がイベントには弱い)
    events: open
      .filter((i) => i.itemType === "EVENT")
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    // 必須 / 任意のタスクは「優先度 → 締切」の順で並べる
    required: open
      .filter((i) => i.itemType === "TASK" && i.required)
      .sort(comparePriorityThenDue),
    optional: open
      .filter((i) => i.itemType === "TASK" && !i.required)
      .sort(comparePriorityThenDue),
    done: items.filter((i) => i.status !== "OPEN"),
  };
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  // 時刻比較・経過分の算出には実時間(UTC epoch)をそのまま使う。
  // 旧コード: toZonedTime(new Date(), APP_TZ).getTime() は wall-clock 表示用に
  //          内部 epoch を +9h ずらすので、dueAt (本物の UTC epoch) との比較が
  //          UTC サーバ上で 9 時間ズレ、「次の予定」が消えたり誤った残時間を出す。
  // toZonedTime は format() に渡すときの局所表示用にだけ使うべきもの。
  const now = new Date();
  const todayYmd = ymdJst(now);

  // isValidYmd は実在する暦日まで検証する(2026-13-40 / 2025-02-30 等は弾く)。
  // 不正値が来たら今日(todayYmd)にフォールバックして、parseYmd 後の format(...)
  // が RangeError で 500 になるのを防ぐ。
  const viewYmd = date && isValidYmd(date) ? date : todayYmd;
  const viewDate = parseYmd(viewYmd);
  const isToday = viewYmd === todayYmd;
  const showTomorrowPrep = isToday; // 他の日を見てる時は翌日プレビューなし

  const { from, to } = monthWindow(viewYmd);
  const indicators = await getMonthlyIndicators(from, to);

  const tomorrowYmd = ymdJst(addDays(viewDate, 1));
  const [primaryItems, tomorrowItems] = await Promise.all([
    getDayItems(viewYmd),
    showTomorrowPrep ? getDayItems(tomorrowYmd) : Promise.resolve([]),
  ]);
  const primary = groupByAxis(primaryItems);
  const tomorrow = showTomorrowPrep ? groupByAxis(tomorrowItems) : null;

  // viewDate は parseYmd 由来で「JST 0:00 を UTC instant で表現」しているため、
  // 非 JST ホスト(例: UTC デプロイ)で date-fns format() を素で叩くと
  // 前日にずれる(Codex review)。formatInTimeZone を経由して APP_TZ で描画する。
  const primaryLabel = formatInTimeZone(viewDate, APP_TZ, "M月d日 (EEE)", {
    locale: ja,
  });
  const tomorrowLabel = formatInTimeZone(
    addDays(viewDate, 1),
    APP_TZ,
    "M月d日 (EEE)",
    { locale: ja },
  );

  const prevYmd = ymdJst(addDays(viewDate, -1));
  const nextYmd = ymdJst(addDays(viewDate, 1));

  const PrimarySection = (
    <DayBlock
      headerIcon={isToday ? null : <CalendarIcon width={18} height={18} />}
      headerTitle={isToday ? "今日" : primaryLabel}
      headerCaption={isToday ? primaryLabel : ""}
      groups={primary}
    />
  );

  // 「次の予定」Quick Answer: 今日を見ているときだけ、現在時刻以降の最初のOPENを抽出
  const nextUp = isToday
    ? primaryItems
        .filter((i) => i.status === "OPEN" && new Date(i.dueAt).getTime() > now.getTime())
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]
    : null;

  const TomorrowSection = tomorrow && (
    <DayBlock
      headerIcon={null}
      headerTitle="明日の準備"
      headerCaption={tomorrowLabel}
      groups={tomorrow}
      prepareMode
    />
  );

  return (
    <SwipeNav todayYmd={todayYmd} prevYmd={prevYmd} nextYmd={nextYmd}>
    <main className="px-4 pt-6 pb-8">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            <span className="tabular-nums">{formatInTimeZone(viewDate, APP_TZ, "yyyy年")}</span>
            <span className="mx-1.5 text-slate-600">·</span>
            <span>{isToday ? "今日" : "閲覧中"}</span>
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold">{primaryLabel}</h1>
        </div>
        <Link
          href="/memo"
          className="shrink-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-200/50 dark:bg-slate-800/50 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300"
        >
          メモ
        </Link>
      </header>

      <DateNav
        viewYmd={viewYmd}
        todayYmd={todayYmd}
        prevYmd={prevYmd}
        nextYmd={nextYmd}
        indicators={indicators}
      />

      {nextUp && <NextUpCard item={nextUp} now={now} />}

      <div className="mt-5 space-y-10">
        {PrimarySection}
        {TomorrowSection}
      </div>
    </main>
    </SwipeNav>
  );
}

function DayBlock({
  headerIcon,
  headerTitle,
  headerCaption,
  groups,
  prepareMode = false,
}: {
  headerIcon: React.ReactNode | null;
  headerTitle: string;
  headerCaption: string;
  groups: ReturnType<typeof groupByAxis>;
  prepareMode?: boolean;
}) {
  const color = "text-sky-300";
  const empty =
    groups.events.length === 0 && groups.required.length === 0 && groups.optional.length === 0;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {headerIcon && (
          <span className={`inline-flex items-center ${color}`}>{headerIcon}</span>
        )}
        <h2 className="text-lg font-semibold">{headerTitle}</h2>
        {headerCaption && <span className="ml-1 text-xs text-slate-500">{headerCaption}</span>}
      </div>

      {empty && (
        <p className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-400">
          予定・タスクはありません
        </p>
      )}

      {groups.events.length > 0 && (
        <Group label="予定" items={groups.events} prepareMode={prepareMode} />
      )}
      {groups.required.length > 0 && (
        <Group label="必須タスク" items={groups.required} prepareMode={prepareMode} />
      )}
      {groups.optional.length > 0 && (
        <Group
          label="任意タスク"
          items={groups.optional}
          prepareMode={prepareMode}
          muted
        />
      )}

      {groups.done.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs text-slate-600 dark:text-slate-400">
            完了済み {groups.done.length} 件
          </summary>
          <ul className="mt-2 space-y-2">
            {groups.done.map((it) => (
              <li key={it.id}>
                <TodayItemCard item={it} prepareMode={prepareMode} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function NextUpCard({ item, now }: { item: TodayItem; now: Date }) {
  const due = new Date(item.dueAt);
  const diffMin = Math.max(0, Math.round((due.getTime() - now.getTime()) / 60_000));
  // UI 全体の他箇所と揃えて JST(APP_TZ)で表示。
  // 旧コードは date-fns の format(due, "HH:mm") を使っており、これは
  // サーバランタイムの TZ に従うので UTC ホストでは 9 時間ズレた時刻になっていた。
  const time = formatInTimeZone(due, APP_TZ, "HH:mm");
  const label =
    item.itemType === "EVENT" ? "次の予定" : item.required ? "次の必須タスク" : "次のタスク";
  const remaining =
    diffMin < 60
      ? `${diffMin}分後`
      : diffMin < 60 * 24
        ? `${Math.floor(diffMin / 60)}時間${diffMin % 60}分後`
        : "今日中";
  return (
    <div className="mt-4 rounded-2xl border border-sky-500/40 bg-sky-500/5 p-3.5">
      <p className="text-[11px] uppercase tracking-wide text-sky-300/80">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums">{time}</span>
        <span className="text-xs text-sky-300/80">残り {remaining}</span>
      </div>
      <p className="mt-0.5 truncate text-sm">{item.title}</p>
    </div>
  );
}

function Group({
  label,
  items,
  prepareMode,
  muted = false,
}: {
  label: string;
  items: TodayItem[];
  prepareMode: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`mb-4 ${muted ? "opacity-85" : ""}`}>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}
      </h3>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.id}>
            <TodayItemCard item={it} prepareMode={prepareMode} />
          </li>
        ))}
      </ul>
    </div>
  );
}
