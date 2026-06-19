// 繰り返しテンプレート (TaskTemplate kind=RECURRING) の一覧 / 作成。
// /templates ページから操作する。授業用 (CLASS) と手動 (MANUAL) は
// 別経路で扱うので、本ルートは RECURRING のみ扱う。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { ItemType, TaskPriority } from "@/lib/validation/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(1).max(120),
  notes: z.string().max(1000).optional().nullable(),
  itemType: ItemType.default("TASK"),
  required: z.boolean().default(true),
  priority: TaskPriority.default("MID"),
  defaultDueOffsetMin: z.number().int().min(-1440).max(1440 * 7).default(0),
  rrule: z.string().min(1).max(200),
});

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const items = await prisma.taskTemplate.findMany({
    where: { kind: "RECURRING" },
    orderBy: { id: "desc" },
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const item = await prisma.taskTemplate.create({
    data: {
      kind: "RECURRING",
      itemType: parsed.data.itemType,
      required: parsed.data.required,
      priority: parsed.data.priority,
      title: parsed.data.title.trim(),
      notes: parsed.data.notes?.trim() || null,
      defaultDueOffsetMin: parsed.data.defaultDueOffsetMin,
      rrule: parsed.data.rrule,
    },
  });
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
