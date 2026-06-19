import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { TaskCreateInput, TaskListQuery } from "@/lib/validation/task";
import { createGoogleEvent } from "@/lib/googleCalendarWrite";

export async function GET(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const url = new URL(req.url);
  const parsed = TaskListQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid query" }, { status: 400 });

  const { from, to, status, priority, tagId } = parsed.data;
  const where: Record<string, unknown> = {};
  if (from || to) {
    where.dueAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (tagId) where.tags = { some: { tagId } };

  const instances = await prisma.taskInstance.findMany({
    where,
    include: {
      tags: { include: { tag: true } },
      checklist: { orderBy: { orderIdx: "asc" } },
    },
    orderBy: { dueAt: "asc" },
    take: 500,
  });
  return NextResponse.json({ instances });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const parsed = TaskCreateInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    title,
    notes,
    dueAt,
    itemType,
    required,
    priority,
    tagIds,
    checklist,
    reminders,
    googleCalendarId,
  } = parsed.data;

  const due = new Date(dueAt);

  // Phase 4: googleCalendarId 指定があれば Google に events.insert してから
  // local 保存。Google 側失敗時は local も作らない (片寄を避ける)。
  // 成功時は source=GOOGLE + sourceExternalId + googleCalendarId で作る
  // (次回 sync で deduplicate される)。
  let googleEventId: string | null = null;
  if (googleCalendarId) {
    const r = await createGoogleEvent(googleCalendarId, {
      title,
      notes: notes ?? null,
      dueAt: due,
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: `Google への作成に失敗しました: ${r.error}` },
        { status: 502 },
      );
    }
    googleEventId = r.eventId;
  }

  const created = await prisma.$transaction(async (tx) => {
    const instance = await tx.taskInstance.create({
      data: {
        title,
        notes,
        dueAt: due,
        itemType,
        required,
        priority,
        source: googleCalendarId ? "GOOGLE" : "MANUAL",
        sourceExternalId: googleEventId,
        googleCalendarId: googleCalendarId ?? null,
        status: "OPEN",
        tags: tagIds.length
          ? {
              create: tagIds.map((tagId) => ({ tagId })),
            }
          : undefined,
        checklist: checklist.length
          ? {
              create: checklist.map((c, i) => ({
                label: c.label,
                orderIdx: c.orderIdx ?? i,
              })),
            }
          : undefined,
      },
      include: {
        tags: { include: { tag: true } },
        checklist: { orderBy: { orderIdx: "asc" } },
      },
    });

    if (reminders.length) {
      for (const r of reminders) {
        const remindAt = new Date(due.getTime() + r.offsetMin * 60_000);
        const dedupeKey = `${instance.id}:${remindAt.toISOString()}:${r.channel}:0`;
        await tx.reminder.create({
          data: {
            instanceId: instance.id,
            remindAt,
            channel: r.channel,
            escalationLevel: 0,
            dedupeKey,
          },
        });
      }
    }
    return instance;
  });

  return NextResponse.json({ instance: created }, { status: 201 });
}
