import { prisma } from "./db";
import type { TodayItem } from "@/app/(app)/today/types";

export async function getDayItems(ymd: string): Promise<TodayItem[]> {
  const from = new Date(ymd + "T00:00:00+09:00");
  const to = new Date(ymd + "T23:59:59+09:00");

  // Phase 14a: multi-day event は dueAt が当日でなくても、endAt が当日以降に
  // 跨いでいれば「その日に出る」べき。range query を overlap 判定に拡張。
  // 旧: dueAt が当日 range 内
  // 新: event 期間 [dueAt, endAt) が [from, to] と重なる
  //     (endAt NULL なら単点で旧条件と同じ)
  const instances = await prisma.taskInstance.findMany({
    where: {
      AND: [
        { dueAt: { lte: to } },
        {
          OR: [
            { endAt: { gte: from } },
            { AND: [{ endAt: null }, { dueAt: { gte: from } }] },
          ],
        },
      ],
    },
    include: {
      tags: { include: { tag: true } },
      checklist: { orderBy: { orderIdx: "asc" } },
    },
    orderBy: { dueAt: "asc" },
  });

  return instances.map((i) => ({
    id: i.id,
    itemType: i.itemType,
    required: i.required,
    source: i.source,
    title: i.title,
    subtitle: i.notes ?? undefined,
    dueAt: i.dueAt.toISOString(),
    endAt: i.endAt?.toISOString() ?? null,
    isAllDay: i.isAllDay,
    priority: i.priority,
    status: i.status,
    tags: i.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    checklist: i.checklist.map((c) => ({
      id: c.id,
      label: c.label,
      checked: c.checkedAt !== null,
    })),
  }));
}
