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
  // Phase 14a.1: where 句では `endAt > from` の strict 比較を使う。
  // all-day event の endAt は exclusive (= 翌日 00:00) なので、from と
  // 等値マッチを許すと 6/19 終了の event が 6/20 に漏れる (review #1)。
  // 反転データ (endAt < dueAt) は理論上ありえないが、誤って入っても少なくとも
  // dueAt が window 内なら拾うよう、OR の 2 つ目を `dueAt overlap` に弱める
  // (review #2)。
  const instances = await prisma.taskInstance.findMany({
    where: {
      AND: [
        { dueAt: { lte: to } },
        {
          OR: [
            { endAt: { gt: from } },
            // endAt が NULL or 反転データの場合は dueAt overlap で拾う。
            // 単点 event (endAt NULL かつ dueAt が window 内) もここでカバー。
            { dueAt: { gte: from } },
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
