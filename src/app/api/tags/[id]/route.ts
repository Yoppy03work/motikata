// タグの単体更新・削除。
// 削除すると関連する TemplateTag / ClassTag / TaskInstanceTag も Cascade で消える。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, "#RRGGBB 形式");

const PatchBody = z.object({
  name: z.string().min(1).max(40).optional(),
  color: HEX_COLOR.optional().nullable(),
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
  if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
  if (parsed.data.color !== undefined) data.color = parsed.data.color;
  try {
    const tag = await prisma.tag.update({ where: { id }, data });
    return NextResponse.json({ ok: true, tag });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "同じ名前のタグが既に存在します" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "更新失敗" }, { status: 500 });
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
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
