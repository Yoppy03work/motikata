import { format } from "date-fns";
import { ja } from "date-fns/locale/ja";
import { toZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";
import {
  DAY_LABELS,
  getWeekItemsByDay,
  isValidYmd,
  shiftWeek,
  weekDates,
  weekStartOf,
} from "@/lib/week";
import { TodayItemCard } from "../today/TodayItemCard";
import { WeekNav } from "./WeekNav";
import type { TodayItem } from "../today/types";

export const dynamic = "force-dynamic";

function ymdJst(d: Date): string {
  return format(toZonedTime(d, APP_TZ), "yyyy-MM-dd");
}

function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const PRIORITY_RANK: Record<TodayItem["priority"], number> = {
  HIGH: 0,
  MID: 1,
  LOW: 2,
};

function sortItems(items: TodayItem[]): TodayItem[] {
  // EVENT は時刻順、TASK は 優先度 → 時刻 で並べる(today/page.tsx と揃える)
  return [...items].sort((a, b) => {
    if (a.itemType === "EVENT" && b.itemType !== "EVENT") return -1;
    if (a.itemType !== "EVENT" && b.itemType === "EVENT") return 1;
    if (a.itemType === "TASK" && b.itemType === "TASK") {
      const pa = PRIORITY_RANK[a.priority] ?? 99;
      const pb = PRIORITY_RANK[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
    }
    return a.dueAt.localeCompare(b.dueAt);
  });
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const todayYmd = ymdJst(new Date());
  const requestedYmd = week && isValidYmd(week) ? week : todayYmd;
  const monday = weekStartOf(requestedYmd);
  const thisMonday = weekStartOf(todayYmd);
  const isThisWeek = monday === thisMonday;

  const dates = weekDates(monday);
  const byDay = await getWeekItemsByDay(monday);
  const prevWeek = shiftWeek(monday, -1);
  const nextWeek = shiftWeek(monday, 1);

  const startDate = ymdToLocalDate(dates[0]);
  const endDate = ymdToLocalDate(dates[6]);
  const rangeLabel = `${format(startDate, "yyyy/M/d")} 〜 ${format(endDate, "M/d")}`;

  // 週合計
  const total = dates.reduce((acc, d) => acc + (byDay[d]?.length ?? 0), 0);
  const openTotal = dates.reduce(
    (acc, d) => acc + (byDay[d]?.filter((i) => i.status !== "DONE").length ?? 0),
    0,
  );

  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-3">
        <h1 className="text-2xl font-semibold">今週のタスク</h1>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          月〜日まで一覧。タップで詳細・完了。
        </p>
      </header>

      <WeekNav
        prevWeek={prevWeek}
        nextWeek={nextWeek}
        isThisWeek={isThisWeek}
        rangeLabel={rangeLabel}
      />

      <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs text-slate-600 dark:text-slate-400">
        合計 {total} 件 · 未完了 {openTotal} 件
      </div>

      <div className="space-y-4">
        {dates.map((d, i) => {
          const items = sortItems(byDay[d] ?? []);
          const isToday = d === todayYmd;
          const dayDate = ymdToLocalDate(d);
          const monthDay = format(dayDate, "M/d", { locale: ja });
          return (
            <section key={d}>
              <h2
                className={`mb-1.5 flex items-baseline gap-2 text-sm font-semibold ${
                  isToday
                    ? "text-sky-700 dark:text-sky-300"
                    : i === 6
                      ? "text-rose-600 dark:text-rose-400"
                      : i === 5
                        ? "text-sky-600 dark:text-sky-400"
                        : "text-slate-800 dark:text-slate-200"
                }`}
              >
                <span className="tabular-nums">{monthDay}</span>
                <span>({DAY_LABELS[i]})</span>
                {isToday && (
                  <span className="text-[11px] font-medium text-sky-700 dark:text-sky-300">
                    · 今日
                  </span>
                )}
                <span className="ml-auto text-[11px] font-medium text-slate-500">
                  {items.length} 件
                </span>
              </h2>
              {items.length === 0 ? (
                <p className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-2.5 text-[11px] text-slate-500">
                  予定・タスクなし
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((it) => (
                    <li key={it.id}>
                      <TodayItemCard item={it} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
