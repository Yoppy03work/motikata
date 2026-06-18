"use client";

import { useRouter } from "next/navigation";
import { MonthCalendar, type DayIndicators, type MonthEvent } from "@/components/MonthCalendar";

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
