import { format, toZonedTime } from "date-fns-tz";
import { APP_TZ } from "./tz";
import type { DayIndicators } from "@/components/MonthCalendar";

function ymd(d: Date): string {
  return format(toZonedTime(d, APP_TZ), "yyyy-MM-dd", { timeZone: APP_TZ });
}

function add(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// MVP: ダミーの月次サマリー。実データに差し替え予定。
export function getDummyMonthlyIndicators(): Record<string, DayIndicators> {
  const today = new Date();
  const map: Record<string, DayIndicators> = {};
  map[ymd(today)] = { events: 1, required: 1, optional: 1 };
  map[ymd(add(today, 1))] = { events: 2, required: 1 };
  map[ymd(add(today, -1))] = { required: 1 };
  map[ymd(add(today, 3))] = { events: 1 };
  map[ymd(add(today, 7))] = { events: 2, required: 2, optional: 1 };
  return map;
}
