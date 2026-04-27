import { format, toZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";
import { getMonthlyIndicators, monthWindow } from "@/lib/indicators";
import { CalendarClient } from "./CalendarClient";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const todayYmd = format(toZonedTime(new Date(), APP_TZ), "yyyy-MM-dd", {
    timeZone: APP_TZ,
  });
  const { from, to } = monthWindow(todayYmd);
  const indicators = await getMonthlyIndicators(from, to);

  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">カレンダー</h1>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          日をタップ → 予定・タスクを追加 / 閲覧(Phase 2でGoogleカレンダーと統合)
        </p>
      </header>
      <CalendarClient todayYmd={todayYmd} indicators={indicators} />
    </main>
  );
}
