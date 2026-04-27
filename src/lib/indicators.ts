import { prisma } from "./db";
import { computeClassDayMap } from "./classDays";
import type { DayIndicators } from "@/components/MonthCalendar";

export async function getMonthlyIndicators(
  fromYmd: string,
  toYmd: string,
): Promise<Record<string, DayIndicators>> {
  const from = new Date(fromYmd + "T00:00:00+09:00");
  const to = new Date(toYmd + "T23:59:59+09:00");

  const [rows, classDayMap] = await Promise.all([
    prisma.taskInstance.findMany({
      where: { dueAt: { gte: from, lte: to } },
      select: { dueAt: true, itemType: true, required: true, status: true },
    }),
    computeClassDayMap(fromYmd, toYmd),
  ]);

  const map: Record<string, DayIndicators> = {};
  // タスクの集計
  for (const r of rows) {
    if (r.status === "DONE") continue;
    // Asia/Tokyo日に丸める
    const jst = new Date(r.dueAt.getTime() + 9 * 60 * 60 * 1000);
    const ymd = jst.toISOString().slice(0, 10);
    const bucket = (map[ymd] ||= { events: 0, required: 0, optional: 0 });
    if (r.itemType === "EVENT") bucket.events = (bucket.events ?? 0) + 1;
    else if (r.required) bucket.required = (bucket.required ?? 0) + 1;
    else bucket.optional = (bucket.optional ?? 0) + 1;
  }
  // 授業日フラグを混ぜる(タスクが無い日にも色を付けたいので、map にエントリを作る)
  for (const [ymd, isClass] of Object.entries(classDayMap)) {
    if (!isClass) continue;
    const bucket = (map[ymd] ||= { events: 0, required: 0, optional: 0 });
    bucket.isClassDay = true;
  }
  return map;
}

export function monthWindow(aroundYmd: string): { from: string; to: string } {
  const d = new Date(aroundYmd + "T00:00:00+09:00");
  const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}
