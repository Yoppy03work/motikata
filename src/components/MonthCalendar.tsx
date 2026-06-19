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
  isClassDay?: boolean;
};

// Google カレンダー風のカラーバー表示で使う、日ごとのイベント1件分の情報。
// indicators (件数のみ) とは別に events?: Record<ymd, MonthEvent[]> を渡したとき、
// MonthCalendar はドット集約ではなく title 付きバーを描画する。
export type MonthEvent = {
  id: number;
  title: string;
  kind: "event" | "required" | "optional";
};

const MAX_BARS_PER_CELL = 3;

function barClass(kind: MonthEvent["kind"]): string {
  if (kind === "event") return "bg-sky-500/90 text-white";
  if (kind === "required") return "bg-rose-500/90 text-white";
  return "bg-slate-400/80 text-white dark:bg-slate-500/80";
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function MonthCalendar({
  selectedYmd,
  todayYmd,
  indicators,
  events,
  onSelect,
  className = "",
}: {
  selectedYmd: string;
  todayYmd: string;
  indicators?: Record<string, DayIndicators>;
  // 渡されたとき、ドット集約をやめてバー表示(Google カレンダー風)に切り替える。
  events?: Record<string, MonthEvent[]>;
  onSelect: (ymd: string) => void;
  className?: string;
}) {
  const useBars = !!events;
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
          const cellEvents = events?.[ymd] ?? [];
          const visibleBars = cellEvents.slice(0, MAX_BARS_PER_CELL);
          const overflow = Math.max(0, cellEvents.length - MAX_BARS_PER_CELL);
          // useBars はモード(レイアウト・凡例)制御。
          // 個別セルで描画するものは「バーが1件以上あればバー、無ければ
          // indicators カウントからドット」にフォールバックする。
          // events が空 {} で返ったとき(新規ユーザ等)や、Promise.all で
          // indicators と events のクエリ間に race が起きて events だけ
          // 拾い損ねたケースでも、indicators 側にカウントが残っていれば
          // 「予定があるはずなのに何も出ない」セルを避けられる。
          const hasBars = visibleBars.length > 0;
          const hasDots = !!(ind && (ind.events || ind.required || ind.optional));
          const dow = d.getDay();
          return (
            <button
              key={ymd}
              onClick={() => onSelect(ymd)}
              className={`relative px-1 pt-1 text-left transition ${
                useBars ? "pb-1 min-h-[5rem]" : "pb-3 min-h-[3.25rem]"
              } ${
                ind?.isClassDay
                  ? "bg-sky-100 dark:bg-sky-500/15"
                  : "bg-white dark:bg-slate-950"
              } ${
                isSelected
                  ? "ring-2 ring-sky-500 ring-inset"
                  : isToday
                    ? "ring-1 ring-sky-500/50 ring-inset"
                    : ""
              } ${inMonth ? "" : "opacity-40"}`}
            >
              <div
                className={`text-xs font-medium leading-none ${
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

              {hasBars ? (
                <CellBars visibleBars={visibleBars} overflow={overflow} />
              ) : hasDots && ind ? (
                <CellDots ind={ind} />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-sky-100 dark:bg-sky-500/15" />
          授業日
        </span>
        {useBars ? (
          <>
            <BarLegend color="bg-sky-500/90" label="予定" />
            <BarLegend color="bg-rose-500/90" label="必須" />
            <BarLegend color="bg-slate-400/80 dark:bg-slate-500/80" label="任意" />
          </>
        ) : (
          <>
            <Legend color="bg-sky-400" label="予定" />
            <Legend color="bg-slate-200" label="必須" />
            <Legend color="bg-slate-500" label="任意" />
          </>
        )}
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

function BarLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2 w-3 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

// 1 セルに最大 3 件、超過は「+N 件」で集約するバー描画。
// セル下部に flex column で並べる(セル上部は日付数字が固定)。
function CellBars({
  visibleBars,
  overflow,
}: {
  visibleBars: MonthEvent[];
  overflow: number;
}) {
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {visibleBars.map((ev) => (
        <div
          key={ev.id}
          className={`truncate rounded-sm px-1 py-px text-[10px] leading-tight ${barClass(ev.kind)}`}
          title={ev.title}
        >
          {ev.title}
        </div>
      ))}
      {overflow > 0 ? (
        <div className="px-1 text-[10px] leading-tight text-slate-600 dark:text-slate-400">
          +{overflow} 件
        </div>
      ) : null}
    </div>
  );
}

// バーが描画されない経路 (CalendarSheet・useBars=true でその日に
// イベントが無いケース) のドット集約フォールバック。
// セル下部に絶対配置して、日付数字の位置を固定する。
function CellDots({ ind }: { ind: DayIndicators }) {
  return (
    <div className="absolute bottom-1 left-1 flex gap-0.5">
      {ind.events ? <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> : null}
      {ind.required ? <span className="h-1.5 w-1.5 rounded-full bg-slate-200" /> : null}
      {ind.optional ? <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> : null}
    </div>
  );
}
