"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MonthCalendar, type DayIndicators, type MonthEvent } from "@/components/MonthCalendar";

// JST における現在の YMD を返す。
// /calendar は server render なので todayYmd はリクエスト時点で固定される。
// 日付跨ぎ後のリンク先(ymd === todayYmd → /today)判定にずれが出るのを
// クライアント側で検知して router.refresh で再 SSR させる。
function nowJstYmd(): string {
  const ms = Date.now() + 9 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function CalendarClient({
  todayYmd,
  indicators,
  events,
}: {
  todayYmd: string;
  indicators?: Record<string, DayIndicators>;
  events?: Record<string, MonthEvent[]>;
}) {
  const router = useRouter();

  // JST の次の 00:00 で server-frozen な todayYmd を再取得する。
  // 23:59 にタブを開きっぱなしにして日付跨ぎが起きると、tap-today の
  // リンク先 /today が「今日」(SSR で再計算した本物の今日)を指して
  // しまい、props.todayYmd が指す「昨日」と齟齬が出る問題への対処。
  // また visibility change で復帰したときも、長時間バックグラウンド
  // 滞在後に日付跨ぎしているケースを拾う。
  useEffect(() => {
    const refreshIfStale = () => {
      if (nowJstYmd() !== todayYmd) router.refresh();
    };

    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const msUntilMidnight =
      (24 - jstNow.getUTCHours()) * 60 * 60 * 1000 -
      jstNow.getUTCMinutes() * 60 * 1000 -
      jstNow.getUTCSeconds() * 1000 -
      jstNow.getUTCMilliseconds() +
      // 切替直後に refresh するため少しだけずらす(クロック誤差吸収)。
      500;
    const t = setTimeout(() => router.refresh(), msUntilMidnight);

    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [router, todayYmd]);

  return (
    <MonthCalendar
      selectedYmd={todayYmd}
      todayYmd={todayYmd}
      indicators={indicators}
      events={events}
      onSelect={(ymd) => {
        // 旧: DayDetailSheet をその場で開いていた。
        // ユーザー要望で、その日の /today?date=YMD ページに遷移する。
        const target = ymd === todayYmd ? "/today" : `/today?date=${ymd}`;
        router.push(target);
      }}
    />
  );
}
