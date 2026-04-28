// メモ(Note)をタスク(TaskInstance)に昇格する。
// 流れ:
//   1. Note を取得
//   2. body の冒頭 1 行をタイトル、残り全文を notes として TaskInstance を作成
//   3. Note.promotedTaskId にリンク + 自動アーカイブ
//
// Body:
//   { dueAt: ISO date-time, required?: boolean, priority?: "LOW"|"MID"|"HIGH" }

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { TaskPriority } from "@/lib/validation/enums";

export const dynamic = "force-dynamic";

const Body = z.object({
  dueAt: z.string().datetime({ offset: true }),
  required: z.boolean().optional().default(true),
  priority: TaskPriority.optional().default("MID"),
});

function splitTitleAndNotes(body: string): { title: string; notes: string } {
  const trimmed = body.trim();
  const newlineIdx = trimmed.indexOf("\n");
  if (newlineIdx === -1) {
    return { title: trimmed.slice(0, 200), notes: "" };
  }
  const head = trimmed.slice(0, newlineIdx).trim();
  const rest = trimmed.slice(newlineIdx + 1).trim();
  return {
    title: head.slice(0, 200) || "(無題)",
    notes: rest,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) {
    return NextResponse.json({ error: "note not found" }, { status: 404 });
  }
  if (note.promotedTaskId) {
    return NextResponse.json(
      { error: "既に昇格済みです", promotedTaskId: note.promotedTaskId },
      { status: 409 },
    );
  }

  const { title, notes } = splitTitleAndNotes(note.body);
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.taskInstance.create({
      data: {
        title,
        notes: notes || null,
        dueAt: new Date(parsed.data.dueAt),
        itemType: "TASK",
        required: parsed.data.required,
        priority: parsed.data.priority,
        source: "MANUAL",
        status: "OPEN",
      },
    });
    await tx.note.update({
      where: { id },
      data: {
        promotedTaskId: task.id,
        // INBOX のメモは自動アーカイブ
        archivedAt: note.kind === "INBOX" ? new Date() : note.archivedAt,
      },
    });
    return task;
  });

  return NextResponse.json({ ok: true, task: result });
}
