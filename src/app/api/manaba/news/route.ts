// manaba のコースニュース(アプリ上の既読管理)。
//   PATCH { ids: number[] | "all", read: boolean }  既読 / 未読にする
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
  ids: z.union([z.literal("all"), z.array(z.number().int().positive()).max(200)]),
  read: z.boolean(),
});

export async function PATCH(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { ids, read } = body.data;
  const res = await prisma.manabaNews.updateMany({
    where: ids === "all" ? { readAt: read ? null : { not: null } } : { id: { in: ids } },
    data: { readAt: read ? new Date() : null },
  });
  return NextResponse.json({ ok: true, updated: res.count });
}
