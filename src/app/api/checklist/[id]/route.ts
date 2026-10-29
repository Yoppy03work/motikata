import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { parseId, zOrderIdx } from "@/lib/id";

const PatchInput = z.object({
  label: z.string().min(1).max(120).optional(),
  orderIdx: zOrderIdx.optional(),
  checked: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const parsed = PatchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) data.label = parsed.data.label;
  if (parsed.data.orderIdx !== undefined) data.orderIdx = parsed.data.orderIdx;
  if (parsed.data.checked !== undefined) data.checkedAt = parsed.data.checked ? new Date() : null;

  const updated = await prisma.taskInstanceCheck.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { id: idStr } = await params;
  const id = parseId(idStr);
  if (id === null) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  await prisma.taskInstanceCheck.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
