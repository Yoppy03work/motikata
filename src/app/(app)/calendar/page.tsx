import { format, toZonedTime } from "date-fns-tz";
import { APP_TZ } from "@/lib/tz";
import { getMonthlyEvents, getMonthlyIndicators } from "@/lib/indicators";
import { CalendarClient } from "./CalendarClient";

export const dynamic = "force-dynamic";

// クライアント側で月送りしても授業日が表示されるよう、
// 現在月から ±12ヶ月の広い範囲を一気に取得する(年度跨ぎに対応)。
function wideRange(todayYmd: string): { from: string; to: string } {
  const [y, m] = todayYmd.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - 12, 1));
  const end = new Date(Date.UTC(y, m - 1 + 13, 0));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

export default async function CalendarPage() {
  const todayYmd = format(toZonedTime(new Date(), APP_TZ), "yyyy-MM-dd", {
    timeZone: APP_TZ,
  });
  const { from, to } = wideRange(todayYmd);
  const [indicators, events] = await Promise.all([
    getMonthlyIndicators(from, to),
    getMonthlyEvents(from, to),
  ]);

  return (
    <main className="px-4 pt-6 pb-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">カレンダー</h1>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          日をタップ → 予定・タスクを追加 / 閲覧(Phase 2でGoogleカレンダーと統合)
        </p>
      </header>
      <CalendarClient todayYmd={todayYmd} indicators={indicators} events={events} />
    </main>
  );
}
