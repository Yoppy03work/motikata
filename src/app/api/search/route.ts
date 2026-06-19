// 全文検索 API。タスクとメモを横断して検索。
// シンプルな ILIKE %q% (Postgres) ベース。50 件まで。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export async function GET(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length < 1) {
    return NextResponse.json({ ok: true, q, tasks: [], notes: [] });
  }

  const [tasks, notes] = await Promise.all([
    prisma.taskInstance.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        itemType: true,
        status: true,
        required: true,
        priority: true,
        notes: true,
        source: true,
      },
      orderBy: { dueAt: "desc" },
      take: LIMIT,
    }),
    prisma.note.findMany({
      where: {
        body: { contains: q, mode: "insensitive" },
      },
      select: {
        id: true,
        body: true,
        kind: true,
        archivedAt: true,
        promotedTaskId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    q,
    tasks: tasks.map((t) => ({
      ...t,
      dueAt: t.dueAt.toISOString(),
    })),
    notes: notes.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
      archivedAt: n.archivedAt?.toISOString() ?? null,
    })),
  });
}
