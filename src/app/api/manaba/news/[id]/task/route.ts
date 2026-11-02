// コースニュースからタスクを作る。POST { dueAt }。同じニュースからは 1 つだけ(2 回目は既存を返す)。
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireAuthApi } from "@/lib/authGuard";
import { prisma } from "@/lib/db";
import { parseId } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ dueAt: z.string().datetime({ offset: true }) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "締切の日時を指定してください" }, { status: 400 });

  const news = await prisma.manabaNews.findUnique({ where: { id } });
  if (!news) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sourceExternalId = `manaba-news:${id}`;
  try {
    const task = await prisma.taskInstance.create({
      data: {
        title: `【${news.courseName}】${news.title}`.slice(0, 200),
        notes: `manaba のコースニュース: ${news.url}`,
        dueAt: new Date(body.data.dueAt),
        itemType: "TASK",
        required: true,
        priority: "MID",
        source: "MANUAL",
        sourceExternalId,
      },
      select: { id: true },
    });
    await prisma.manabaNews.update({ where: { id }, data: { readAt: news.readAt ?? new Date() } });
    return NextResponse.json({ ok: true, taskId: task.id, created: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.taskInstance.findFirst({
        where: { source: "MANUAL", sourceExternalId },
        select: { id: true },
      });
      return NextResponse.json({ ok: true, taskId: existing?.id ?? null, created: false });
    }
    throw e;
  }
}
