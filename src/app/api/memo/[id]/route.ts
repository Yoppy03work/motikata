import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { NoteUpdateInput } from "@/lib/validation/memo";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const parsed = NoteUpdateInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.body !== undefined) data.body = parsed.data.body;
  if (parsed.data.archived !== undefined) {
    data.archivedAt = parsed.data.archived ? new Date() : null;
  }
  if (parsed.data.diaryDate !== undefined) {
    data.diaryDate = parsed.data.diaryDate
      ? new Date(parsed.data.diaryDate + "T00:00:00+09:00")
      : null;
  }

  const note = await prisma.note.update({ where: { id }, data });
  return NextResponse.json({ note });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await prisma.note.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
