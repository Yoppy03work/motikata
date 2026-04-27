import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { TaskCreateInput, TaskListQuery } from "@/lib/validation/task";

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

  const { title, notes, dueAt, itemType, required, priority, tagIds, checklist, reminders } =
    parsed.data;

  const due = new Date(dueAt);

  const created = await prisma.$transaction(async (tx) => {
    const instance = await tx.taskInstance.create({
      data: {
        title,
        notes,
        dueAt: due,
        itemType,
        required,
        priority,
        source: "MANUAL",
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
