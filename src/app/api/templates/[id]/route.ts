// 繰り返しテンプレートの個別 PATCH / DELETE。
// DELETE は cascade で関連 TemplateTag を消し、派生 TaskInstance.templateId は
// SetNull になる。ただし expandToday で先に materialize されていた
// 未来の TaskInstance(source=RECURRING, sourceExternalId=recurring:<id>:<ymd>)
// は orphan として残るので、PATCH / DELETE 双方で明示的に reconcile する。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { ItemType, TaskPriority } from "@/lib/validation/enums";
import { matchesOn } from "@/lib/rrule";

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
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.taskTemplate.findUnique({ where: { id } });
      if (!existing) {
        // 後段の update が P2025 を投げてくれるが、明示的に短絡する。
        throw new Prisma.PrismaClientKnownRequestError("not found", {
          code: "P2025",
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      const updated = await tx.taskTemplate.update({
        where: { id },
        data,
      });

      // expandToday が先に作っていた未来 OPEN な TaskInstance を新仕様で
      // 更新する。23:00 ティックは recurring:<id>:<ymd> で既存検知→skip
      // するので、明示的に更新しないと「今日/明日のリスト」に古いタイトル/
      // 古い dueAt / 古い rrule で残ってしまう。
      // 過去分(dueAt <= now)は履歴/完了状況の記録として保持する。
      const now = new Date();
      const futureOpen = await tx.taskInstance.findMany({
        where: {
          source: "RECURRING",
          templateId: id,
          status: "OPEN",
          dueAt: { gt: now },
        },
        select: { id: true, sourceExternalId: true },
      });

      // 新仕様の値(リクエストで指定されたものは新、無指定は既存値)
      const newTitle =
        parsed.data.title !== undefined ? parsed.data.title.trim() : updated.title;
      const newNotes =
        parsed.data.notes !== undefined
          ? parsed.data.notes?.trim() || null
          : updated.notes;
      const newItemType = parsed.data.itemType ?? updated.itemType;
      const newRequired = parsed.data.required ?? updated.required;
      const newPriority = parsed.data.priority ?? updated.priority;
      const newOffset =
        parsed.data.defaultDueOffsetMin ?? updated.defaultDueOffsetMin;
      const newRrule = parsed.data.rrule ?? updated.rrule;

      for (const fi of futureOpen) {
        if (!fi.sourceExternalId) continue;
        // sourceExternalId = "recurring:<templateId>:<ymd>"
        const parts = fi.sourceExternalId.split(":");
        const ymd = parts[2];
        if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        // rrule 変更で「マッチしなくなった日」のインスタンスは削除する
        // (例: daily→weekly で平日のみ → 該当しない日の future instance を破棄)。
        if (!matchesOn(newRrule, ymd)) {
          await tx.taskInstance.delete({ where: { id: fi.id } });
          continue;
        }
        // 新しい defaultDueOffsetMin で dueAt を再計算。
        // ymd 00:00 JST + offset 分。
        const dayStartJst = new Date(`${ymd}T00:00:00+09:00`);
        const newDueAt = new Date(
          dayStartJst.getTime() + newOffset * 60_000,
        );
        await tx.taskInstance.update({
          where: { id: fi.id },
          data: {
            title: newTitle,
            notes: newNotes,
            itemType: newItemType,
            required: newRequired,
            priority: newPriority,
            dueAt: newDueAt,
          },
        });
      }
      return updated;
    });
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
    await prisma.$transaction(async (tx) => {
      // 未来分の OPEN な展開済み TaskInstance を一掃する。
      // schema は TaskInstance.templateId に onDelete: SetNull を付けて
      // いるので、何もしないと future な「孤児タスク」(templateId=null,
      // sourceExternalId=recurring:<id>:<ymd>)が残り、ユーザが繰り返しを
      // 消した後も明日以降のリストに出続ける。expandToday は templateId が
      // null になった行を見ても再生成せず、削除も出来ないので、ここで
      // 明示的に消す。
      // 過去分は完了履歴として保持する。
      const now = new Date();
      await tx.taskInstance.deleteMany({
        where: {
          source: "RECURRING",
          templateId: id,
          status: "OPEN",
          dueAt: { gt: now },
        },
      });
      await tx.taskTemplate.delete({ where: { id } });
    });
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
