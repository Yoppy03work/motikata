"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale/ja";
import { CalendarSheet } from "@/components/CalendarSheet";
import { CalendarIcon } from "@/components/icons";
import type { DayIndicators } from "@/components/MonthCalendar";

// ストリップに描画する片側の日数(前後1ヶ月)。
// 端のチップをタップすると新しい選択日が中央に寄せられ、そこから更に前後1ヶ月が見える。
const STRIP_HALF = 30;

// ymd ("YYYY-MM-DD") は「JST における日付」の文字列。
// 表示用 Date はローカル深夜の同 y/m/d を作る(format が JST 文脈の y/m/d を
// そのまま吐けるよう、TZ オフセットを介さない構造にする)。
function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// 日付演算は文字列ベースで行う。Date を経由すると client の TZ で前日に
// シフトすることがあるため(例: UTC 環境で +09:00 の Date を local 解釈すると
// 日付がずれる)。
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // UTC で計算してから UTC で取り出すことで、ホストの TZ に左右されない
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + n);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function DateNav({
  viewYmd,
  todayYmd,
  prevYmd,
  nextYmd,
  indicators,
}: {
  viewYmd: string;
  todayYmd: string;
  prevYmd: string;
  nextYmd: string;
  indicators?: Record<string, DayIndicators>;
}) {
  const router = useRouter();
  const isToday = viewYmd === todayYmd;
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const offsets: number[] = [];
  for (let n = -STRIP_HALF; n <= STRIP_HALF; n++) offsets.push(n);
  const strip = offsets.map((n) => addDays(viewYmd, n));

  const go = (ymd: string) => {
    const q = ymd === todayYmd ? "" : `?date=${ymd}`;
    router.push(`/today${q}`);
  };

  // viewYmd が変わる度に、選択チップを水平中央に寄せる。
  // 初回マウント時は瞬時、それ以降はスムーズに。
  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = activeRef.current;
    if (!scroller || !active) return;
    const target =
      active.offsetLeft - scroller.clientWidth / 2 + active.clientWidth / 2;
    scroller.scrollTo({ left: target, behavior: "smooth" });
  }, [viewYmd]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href={prevYmd === todayYmd ? "/today" : `/today?date=${prevYmd}`}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 active:scale-95"
          aria-label="前日へ"
        >
          ‹ 前日
        </Link>

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 active:scale-95"
          aria-label="カレンダーから日付を選ぶ"
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <CalendarIcon width={14} height={14} />
            <span>{isToday ? "カレンダー" : "別の日を選ぶ"}</span>
          </span>
        </button>

        {!isToday && (
          <Link
            href="/today"
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-300"
          >
            今日
          </Link>
        )}

        <Link
          href={nextYmd === todayYmd ? "/today" : `/today?date=${nextYmd}`}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 active:scale-95"
          aria-label="翌日へ"
        >
          翌日 ›
        </Link>
      </div>

      <div
        ref={scrollerRef}
        data-swipe-ignore
        className="mt-3 -mx-4 overflow-x-auto overscroll-x-contain scroll-smooth px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-w-max gap-1.5">
          {strip.map((ymd) => {
            const d = ymdToLocalDate(ymd);
            const isView = ymd === viewYmd;
            const isCurrent = ymd === todayYmd;
            return (
              <button
                key={ymd}
                ref={isView ? activeRef : undefined}
                onClick={() => go(ymd)}
                className={`flex min-w-[3rem] flex-col items-center rounded-lg px-2 py-1.5 text-xs transition ${
                  isView
                    ? "bg-sky-500 text-slate-950"
                    : isCurrent
                      ? "border border-sky-500/40 bg-slate-100 dark:bg-slate-900 text-sky-300"
                      : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400"
                }`}
              >
                <span className="text-[10px] opacity-80">
                  {format(d, "EEE", { locale: ja })}
                </span>
                <span className="text-sm font-semibold">{format(d, "d")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <CalendarSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        selectedYmd={viewYmd}
        todayYmd={todayYmd}
        indicators={indicators}
        onSelect={go}
      />
    </div>
  );
}
