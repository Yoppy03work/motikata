"use client";

import { useEffect } from "react";
import { MonthCalendar, type DayIndicators } from "./MonthCalendar";

export function CalendarSheet({
  open,
  onClose,
  selectedYmd,
  todayYmd,
  indicators,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  selectedYmd: string;
  todayYmd: string;
  indicators?: Record<string, DayIndicators>;
  onSelect: (ymd: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <MonthCalendar
          selectedYmd={selectedYmd}
          todayYmd={todayYmd}
          indicators={indicators}
          onSelect={(ymd) => {
            onSelect(ymd);
            onClose();
          }}
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              onSelect(todayYmd);
              onClose();
            }}
            className="flex-1 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2 text-sm text-sky-300"
          >
            今日に戻る
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
