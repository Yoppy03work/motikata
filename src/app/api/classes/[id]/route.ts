// 時間割エントリの個別更新・削除。

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

// hex カラー(#RGB / #RRGGBB) または null(自動配色に戻す)。
const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "色は #RRGGBB 形式で指定")
  .optional()
  .nullable();

// UI は月-土 (1..6) のみ表示するので入力もそれに揃える。
// 以前 7(日曜)まで許容していたが、保存されると一覧から消える hidden 行になるため禁止。
const UpdateBody = z
  .object({
    dayOfWeek: z.number().int().min(1).max(6).optional(),
    period: z.number().int().min(1).max(10).optional(),
    endPeriod: z.number().int().min(1).max(10).optional(),
    startTime: HHmm.optional(),
    endTime: HHmm.optional(),
    courseName: z.string().min(1).max(120).optional(),
    classroom: z.string().max(60).optional().nullable(),
    teacher: z.string().max(60).optional().nullable(),
    color: HexColor,
  })
  .refine(
    (v) => v.period === undefined || v.endPeriod === undefined || v.endPeriod >= v.period,
    {
      message: "終了限は開始限以上にしてください",
      path: ["endPeriod"],
    },
  );

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

  // 既存行を取って、partial update のときも (period, endPeriod) の整合性を
  // 保存後の値で再検証する。例えば現在 period=5/endPeriod=5 の行に
  // { endPeriod: 1 } だけ送られたら、保存後は period=5/endPeriod=1 で
  // 不整合になる。これを 400 で弾く。
  const existing = await prisma.classSchedule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const nextPeriod = parsed.data.period ?? existing.period;
  const nextEndPeriod = parsed.data.endPeriod ?? existing.endPeriod;
  if (nextEndPeriod < nextPeriod) {
    return NextResponse.json(
      {
        error: {
          fieldErrors: { endPeriod: ["終了限は開始限以上にしてください"] },
        },
      },
      { status: 400 },
    );
  }

  // 表示に効くフィールドが変わったかを保存前に判定しておく。
  // 変化なし(色だけ変更など)は未来の TaskInstance を触らない。
  const nextStartTime = parsed.data.startTime ?? existing.startTime;
  const nextCourseName = parsed.data.courseName ?? existing.courseName;
  const nextClassroom =
    parsed.data.classroom === undefined
      ? existing.classroom
      : parsed.data.classroom;
  const nextTeacher =
    parsed.data.teacher === undefined ? existing.teacher : parsed.data.teacher;
  const displayChanged =
    existing.startTime !== nextStartTime ||
    existing.courseName !== nextCourseName ||
    (existing.classroom ?? null) !== (nextClassroom ?? null) ||
    (existing.teacher ?? null) !== (nextTeacher ?? null);

  try {
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.classSchedule.update({
        where: { id },
        data: parsed.data,
      });

      // expand-today が既に materialize 済みの未来 TaskInstance(source=CLASS,
      // status=OPEN)を新しい表示情報で書き直す。
      // citPortalSync の case 1 と同じ趣旨: 23:00 expand-today は
      // class:<id>:<ymd> で既存判定→skip するので、ここで直接更新しないと
      // 「明日の準備」カードが古い時刻/教室で出続ける。
      if (displayChanged) {
        const now = new Date();
        const futureInstances = await tx.taskInstance.findMany({
          where: {
            source: "CLASS",
            sourceExternalId: { startsWith: `class:${id}:` },
            status: "OPEN",
            dueAt: { gt: now },
          },
          select: { id: true, sourceExternalId: true },
        });
        const titleSuffix = nextClassroom ? ` @${nextClassroom}` : "";
        const newTitle = `${nextCourseName}${titleSuffix}`;
        const newNotes = nextTeacher ? `担当: ${nextTeacher}` : null;
        for (const fi of futureInstances) {
          if (!fi.sourceExternalId) continue;
          const parts = fi.sourceExternalId.split(":");
          const ymd = parts[2];
          if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
          const newDueAt = new Date(`${ymd}T${nextStartTime}:00+09:00`);
          await tx.taskInstance.update({
            where: { id: fi.id },
            data: {
              title: newTitle,
              notes: newNotes,
              dueAt: newDueAt,
            },
          });
        }
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
  // ChecklistTemplate (ownerType=CLASS, ownerId=classId) は FK ではなく
  // 緩い参照なので、ClassSchedule 削除だけだと孤児行が残る。同じ
  // トランザクション内でクリーンアップする。
  //
  // 並行 PUT /api/classes/[id]/items との race を避けるため、まず親行に
  // SELECT FOR UPDATE で排他ロックを取り、続いて templates と class 本体を
  // 消す。PUT 側も同じ順序(親 FOR UPDATE → templates → ...)でロックを
  // 取るので deadlock せず serialize される。
  try {
    const ok = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM "ClassSchedule" WHERE id = ${id} FOR UPDATE
      `;
      if (locked.length === 0) return false;
      await tx.checklistTemplate.deleteMany({
        where: { ownerType: "CLASS", ownerId: id },
      });
      // expand-today で先に materialize されていた未来の TaskInstance も
      // 一緒に消す。FK が無いので明示削除しないと孤児授業 EVENT が翌日以降
      // の Today / 「明日の準備」セクションに残る。
      // 過去分は学習履歴/チェック進捗の記録として保持する。
      // citPortalSync の reconciliation 経路と同じ方針。
      const now = new Date();
      await tx.taskInstance.deleteMany({
        where: {
          source: "CLASS",
          sourceExternalId: { startsWith: `class:${id}:` },
          dueAt: { gt: now },
        },
      });
      await tx.classSchedule.delete({ where: { id } });
      return true;
    });
    if (!ok) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
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
