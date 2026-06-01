// 授業ごとの持ち物テンプレート管理。
// ChecklistTemplate (ownerType=CLASS, ownerId=classId) を CRUD。
// PUT は「全置換」運用(送られたリストで上書き)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const PutBody = z.object({
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        orderIdx: z.number().int().min(0).optional(),
      }),
    )
    .max(100),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const classId = Number(idStr);
  if (!Number.isInteger(classId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const items = await prisma.checklistTemplate.findMany({
    where: { ownerType: "CLASS", ownerId: classId },
    orderBy: { orderIdx: "asc" },
  });
  return NextResponse.json({ ok: true, items });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const classId = Number(idStr);
  if (!Number.isInteger(classId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // ChecklistTemplate は ownerType + ownerId の緩い参照で ClassSchedule に
  // 紐付くだけで、DB レベルの FK 制約は無い。ここで親 ClassSchedule の存在を
  // 検証してから書き込まないと、別タブで授業を削除した後の遅延 PUT が
  // 「孤児チェックリスト」を生成し、UI から到達不能になる。
  //
  // 単純な findUnique では「PUT が親を読んだ直後に DELETE が走って親と
  // 既存テンプレを消し、PUT が createMany で孤児行を作る」という race が
  // 残るので、Postgres の SELECT ... FOR UPDATE で親行に書き込みロックを
  // 取ってから走らせる。DELETE 側は行削除自体が行ロックを取るので、
  // 同じトランザクション順序で serialize される(先に DELETE が commit
  // されたら FOR UPDATE は空集合を返して 404)。
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM "ClassSchedule" WHERE id = ${classId} FOR UPDATE
    `;
    if (locked.length === 0) return { ok: false as const };
    await tx.checklistTemplate.deleteMany({
      where: { ownerType: "CLASS", ownerId: classId },
    });
    // 正規化された新テンプレ一覧。order を確定しておく。
    const newItems = parsed.data.items.map((it, i) => ({
      label: it.label.trim(),
      orderIdx: it.orderIdx ?? i,
    }));
    if (newItems.length > 0) {
      await tx.checklistTemplate.createMany({
        data: newItems.map((it) => ({
          ownerType: "CLASS",
          ownerId: classId,
          label: it.label,
          orderIdx: it.orderIdx,
        })),
      });
    }

    // expandToday が既に未来分の TaskInstance を作っていた場合、その紐づく
    // TaskInstanceCheck は古いラベル/順序のままで残る。23:00 expand-today も
    // class:<scheduleId>:<ymd> で既存検知 → skip するので、明示的に同期しないと
    // 「明日の準備」のチェックリストが古い持ち物を表示し続ける。
    //
    // 戦略: 未来 OPEN な class 用 TaskInstance を引き、各インスタンスについて
    //   - 既存 check のうち、新テンプレに label が残っているものは保持
    //     (checkedAt を継承)。
    //   - 新テンプレで増えた label は新規挿入。
    //   - 新テンプレから消えた label は削除。
    //   - 順序(orderIdx)は新テンプレに合わせて再整列。
    // 過去分(dueAt <= now)は履歴として触らない。
    const now = new Date();
    const futureInstances = await tx.taskInstance.findMany({
      where: {
        source: "CLASS",
        sourceExternalId: { startsWith: `class:${classId}:` },
        status: "OPEN",
        dueAt: { gt: now },
      },
      select: {
        id: true,
        checklist: {
          select: {
            id: true,
            label: true,
            checkedAt: true,
            orderIdx: true,
          },
        },
      },
    });

    for (const fi of futureInstances) {
      const oldByLabel = new Map(fi.checklist.map((c) => [c.label, c]));
      const newLabels = new Set(newItems.map((it) => it.label));

      // 1) 新テンプレから消えた label の check を削除
      const removeIds = fi.checklist
        .filter((c) => !newLabels.has(c.label))
        .map((c) => c.id);
      if (removeIds.length > 0) {
        await tx.taskInstanceCheck.deleteMany({
          where: { id: { in: removeIds } },
        });
      }

      // 2) 新テンプレの順序で update / insert
      for (const it of newItems) {
        const existing = oldByLabel.get(it.label);
        if (existing) {
          if (existing.orderIdx !== it.orderIdx) {
            await tx.taskInstanceCheck.update({
              where: { id: existing.id },
              data: { orderIdx: it.orderIdx },
            });
          }
          // checkedAt は保持(ユーザのチェック状態を尊重)
        } else {
          await tx.taskInstanceCheck.create({
            data: {
              instanceId: fi.id,
              label: it.label,
              orderIdx: it.orderIdx,
            },
          });
        }
      }
    }

    return { ok: true as const };
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: "class not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, count: parsed.data.items.length });
}
