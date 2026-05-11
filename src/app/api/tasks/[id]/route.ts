// TaskInstance の単体更新(優先度・必須フラグ・タイトル・notes など)。
// 完了/スヌーズ/未完了は専用ルート(complete/snooze/uncomplete)が別にあるので、
// ここでは「メタデータの編集」用として PATCH のみ提供。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { ItemType, TaskPriority } from "@/lib/validation/enums";

export const dynamic = "force-dynamic";

const PatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(2000).optional().nullable(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    itemType: ItemType.optional(),
    required: z.boolean().optional(),
    priority: TaskPriority.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "更新内容が指定されていません",
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
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.dueAt !== undefined) data.dueAt = new Date(parsed.data.dueAt);
  if (parsed.data.itemType !== undefined) data.itemType = parsed.data.itemType;
  if (parsed.data.required !== undefined) data.required = parsed.data.required;
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;

  try {
    const updated = await prisma.taskInstance.update({
      where: { id },
      data,
    });
    return NextResponse.json({ ok: true, item: updated });
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
