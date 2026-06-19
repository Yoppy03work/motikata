// TaskInstance の単体更新(優先度・必須フラグ・タイトル・notes など)。
// 完了/スヌーズ/未完了は専用ルート(complete/snooze/uncomplete)が別にあるので、
// ここでは「メタデータの編集」用として PATCH のみ提供。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { ItemType, TaskPriority } from "@/lib/validation/enums";
import {
  deleteGoogleEventForTaskInstance,
  pushTaskInstanceToGoogle,
} from "@/lib/googleCalendarWrite";

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
    // Phase 3: GOOGLE 由来のタスクは Google 側 events.patch にも反映する。
    // 失敗しても local 更新は維持し、レスポンスに googlePushError を入れて
    // UI 側に通知する。再 sync で乖離は検出/補正される (next pull で
    // sourceExternalId マッチで Google 値が local に戻る)。
    let googlePushError: string | undefined;
    let googleConflict = false;
    if (updated.source === "GOOGLE") {
      const r = await pushTaskInstanceToGoogle(updated.id, {
        title: parsed.data.title,
        notes: parsed.data.notes ?? undefined,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      });
      if (!r.ok) {
        googlePushError = r.error;
        googleConflict = !!r.conflict;
      }
    }
    return NextResponse.json({
      ok: true,
      item: updated,
      ...(googlePushError ? { googlePushError } : {}),
      ...(googleConflict ? { googleConflict: true } : {}),
    });
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

// DELETE /api/tasks/[id]
// TaskInstance を実削除。GOOGLE 由来なら Google 側 event も削除する。
// Google 側削除が失敗しても local は消す (戻り値に warning を入れて UI に通知)。
// これにより「Google で復活させた」シナリオも次回 sync で自然に取り込まれる。
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
  const existing = await prisma.taskInstance.findUnique({
    where: { id },
    select: { source: true },
  });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  let googleDeleteError: string | undefined;
  if (existing.source === "GOOGLE") {
    const r = await deleteGoogleEventForTaskInstance(id);
    if (!r.ok) googleDeleteError = r.error;
  }
  try {
    await prisma.taskInstance.delete({ where: { id } });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2025"
    ) {
      // 並行削除で消えていた → 成功扱い
      return NextResponse.json({ ok: true });
    }
    throw e;
  }
  return NextResponse.json({
    ok: true,
    ...(googleDeleteError ? { googleDeleteError } : {}),
  });
}
