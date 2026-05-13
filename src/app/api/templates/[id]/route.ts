// 繰り返しテンプレートの個別 PATCH / DELETE。
// DELETE は cascade で関連 TemplateTag / 派生 TaskInstance.templateId=null (SetNull) になる。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { ItemType, TaskPriority } from "@/lib/validation/enums";

export const dynamic = "force-dynamic";

const UpdateBody = z.object({
  title: z.string().min(1).max(120).optional(),
  notes: z.string().max(1000).optional().nullable(),
  itemType: ItemType.optional(),
  required: z.boolean().optional(),
  priority: TaskPriority.optional(),
  defaultDueOffsetMin: z.number().int().min(-1440).max(1440 * 7).optional(),
  rrule: z.string().min(1).max(200).optional(),
});

export async function PATCH(
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
  const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title.trim();
  if (parsed.data.notes !== undefined)
    data.notes = parsed.data.notes?.trim() || null;
  if (parsed.data.itemType !== undefined) data.itemType = parsed.data.itemType;
  if (parsed.data.required !== undefined) data.required = parsed.data.required;
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
  if (parsed.data.defaultDueOffsetMin !== undefined)
    data.defaultDueOffsetMin = parsed.data.defaultDueOffsetMin;
  if (parsed.data.rrule !== undefined) data.rrule = parsed.data.rrule;
  try {
    const item = await prisma.taskTemplate.update({ where: { id }, data });
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    await prisma.taskTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw e;
  }
}
