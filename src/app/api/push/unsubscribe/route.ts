// PushSubscription を削除(ユーザがブラウザで unsubscribe したとき呼ぶ)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url().max(2000),
});

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint },
  });
  return NextResponse.json({ ok: true });
}
