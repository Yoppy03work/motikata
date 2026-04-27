import { prisma } from "./db";
import type { TodayItem } from "@/app/(app)/today/types";

export async function getDayItems(ymd: string): Promise<TodayItem[]> {
  const from = new Date(ymd + "T00:00:00+09:00");
  const to = new Date(ymd + "T23:59:59+09:00");

  const instances = await prisma.taskInstance.findMany({
    where: { dueAt: { gte: from, lte: to } },
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
