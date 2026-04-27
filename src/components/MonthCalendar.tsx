"use client";

import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ja } from "date-fns/locale/ja";

export type DayIndicators = {
  events?: number;
  required?: number;
  optional?: number;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function MonthCalendar({
  selectedYmd,
  todayYmd,
  indicators,
  onSelect,
  className = "",
}: {
  selectedYmd: string;
  todayYmd: string;
  indicators?: Record<string, DayIndicators>;
  onSelect: (ymd: string) => void;
  className?: string;
}) {
  const initialMonth = useMemo(() => {
    // selectedYmd は JST 文脈の "YYYY-MM-DD"。Date 経由で +09:00 を介すと
    // 非 JST クライアントで月がずれるため、文字列から直接 y/m を抽出する。
    const [y, m] = selectedYmd.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [selectedYmd]);
  const [cursor, setCursor] = useState<Date>(initialMonth);

  const monthCells = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    // 24時間固定のミリ秒加算は DST 切替を跨ぐと日付が重複/欠落するため、
    // カレンダー日単位の addDays を使う(date-fns は DST 認識)。
    const cells: Date[] = [];
    for (let d = start; !isAfter(d, end); d = addDays(d, 1)) {
      cells.push(d);
    }
    return cells;
  }, [cursor]);

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 active:scale-95"
          aria-label="前月"
        >
          ‹
        </button>
        <h2 className="text-base font-semibold">
          {format(cursor, "yyyy年 M月", { locale: ja })}
        </h2>
        <button
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 active:scale-95"
          aria-label="翌月"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-xl bg-slate-200 dark:bg-slate-800 p-px">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`bg-white dark:bg-slate-950 py-1.5 text-center text-[11px] ${
              i === 0 ? "text-rose-400" : i === 6 ? "text-sky-400" : "text-slate-600 dark:text-slate-400"
            }`}
          >
            {w}
          </div>
        ))}

        {monthCells.map((d) => {
          const ymd = format(d, "yyyy-MM-dd");
          const inMonth = isSameMonth(d, cursor);
          const isToday = ymd === todayYmd;
          const isSelected = ymd === selectedYmd;
          const ind = indicators?.[ymd];
          const dow = d.getDay();
          return (
            <button
              key={ymd}
              onClick={() => onSelect(ymd)}
              className={`relative min-h-[3.25rem] bg-white dark:bg-slate-950 px-1 py-1 text-left transition ${
                isSelected
                  ? "ring-2 ring-sky-500 ring-inset"
                  : isToday
                    ? "ring-1 ring-sky-500/50 ring-inset"
                    : ""
              } ${inMonth ? "" : "opacity-40"}`}
            >
              <div
                className={`text-xs font-medium ${
                  isSelected
                    ? "text-sky-300"
                    : isToday
                      ? "text-sky-400"
                      : dow === 0
                        ? "text-rose-400/90"
                        : dow === 6
                          ? "text-sky-400/90"
                          : "text-slate-800 dark:text-slate-200"
                }`}
              >
                {format(d, "d")}
              </div>
              {ind && (
                <div className="mt-1 flex gap-0.5">
                  {ind.events ? <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> : null}
                  {ind.required ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
                  ) : null}
                  {ind.optional ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                  ) : null}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
        <Legend color="bg-sky-400" label="予定" />
        <Legend color="bg-slate-200" label="必須" />
        <Legend color="bg-slate-500" label="任意" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}
