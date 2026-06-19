"use client";

import Link from "next/link";

export function WeekNav({
  prevWeek,
  nextWeek,
  isThisWeek,
  rangeLabel,
}: {
  prevWeek: string;
  nextWeek: string;
  isThisWeek: boolean;
  rangeLabel: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Link
        href={`/tasks?week=${prevWeek}`}
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 active:scale-95"
        aria-label="前の週"
      >
        ‹ 先週
      </Link>
      <div className="flex-1 truncate text-center text-xs text-slate-700 dark:text-slate-300">
        {rangeLabel}
      </div>
      {!isThisWeek && (
        <Link
          href="/tasks"
          className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300"
        >
          今週
        </Link>
      )}
      <Link
        href={`/tasks?week=${nextWeek}`}
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 active:scale-95"
        aria-label="次の週"
      >
        翌週 ›
      </Link>
    </div>
  );
}
