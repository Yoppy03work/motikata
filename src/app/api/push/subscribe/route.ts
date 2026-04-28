// PushSubscription を DB に保存。
// 同じ endpoint があれば update(p256dh / auth / userAgent をリフレッシュ)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const Body = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(200),
  }),
  userAgent: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { endpoint, keys, userAgent } = parsed.data;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    },
    update: {
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: userAgent ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}
