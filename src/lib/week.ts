// 週単位の日付ユーティリティ。
// 週は JST 月曜開始(月-日)。
// すべての日付文字列は JST 文脈の "YYYY-MM-DD"。

import { prisma } from "./db";
import type { TodayItem } from "@/app/(app)/today/types";

export const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 10);
}

function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * JST 文脈の任意の日付を含む週の月曜日 (JST) を YYYY-MM-DD で返す。
 */
export function weekStartOf(ymd: string): string {
  const d = ymdToLocalDate(ymd);
  // JS の getDay(): 0=日, 1=月, ..., 6=土。月曜(=1) を week start にする。
  const dow = d.getDay();
  // 月曜まで戻す日数: 月=0, 火=1, ..., 日=6
  const diff = (dow + 6) % 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * 週の月曜から日曜までの 7 日分の YYYY-MM-DD 配列を返す。
 */
export function weekDates(mondayYmd: string): string[] {
  const monday = ymdToLocalDate(mondayYmd);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${dd}`);
  }
  return out;
}

/** 週の前後を計算。 */
export function shiftWeek(mondayYmd: string, deltaWeeks: number): string {
  const monday = ymdToLocalDate(mondayYmd);
  const shifted = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + deltaWeeks * 7,
  );
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** YYYY-MM-DD 妥当性チェック(API 引数用)。 */
export function isValidYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * 週(月曜〜日曜 JST)分のタスクを ymd 別にバケットして返す。
 */
export async function getWeekItemsByDay(
  mondayYmd: string,
): Promise<Record<string, TodayItem[]>> {
  const dates = weekDates(mondayYmd);
  const from = new Date(`${dates[0]}T00:00:00+09:00`);
  const to = new Date(`${dates[6]}T23:59:59+09:00`);

  const instances = await prisma.taskInstance.findMany({
    where: { dueAt: { gte: from, lte: to } },
    include: {
      tags: { include: { tag: true } },
      checklist: { orderBy: { orderIdx: "asc" } },
    },
    orderBy: { dueAt: "asc" },
  });

  const byDay: Record<string, TodayItem[]> = {};
  for (const ymd of dates) byDay[ymd] = [];

  for (const i of instances) {
    const ymd = jstYmd(i.dueAt);
    if (!(ymd in byDay)) continue;
    byDay[ymd].push({
      id: i.id,
      itemType: i.itemType,
      required: i.required,
      source: i.source,
      title: i.title,
      subtitle: i.notes ?? undefined,
      dueAt: i.dueAt.toISOString(),
      priority: i.priority,
      status: i.status,
      tags: i.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      checklist: i.checklist.map((c) => ({
        id: c.id,
        label: c.label,
        checked: c.checkedAt !== null,
      })),
    });
  }
  return byDay;
}
