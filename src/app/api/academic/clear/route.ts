// 学年度単位で AcademicEvent を一括削除する(古い年度の片付け用)。
// 認証必須、明示的に academicYear を指定する必要がある(誤爆防止)。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

const Body = z.object({
  academicYear: z.number().int().min(2000).max(2100),
});

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const ay = parsed.data.academicYear;
  // 学年度 X = X 年 4/1 0:00 JST 〜 (X+1) 年 4/1 0:00 JST 未満
  // JST 4/1 0:00 = UTC (X-1)/03/31 15:00
  const from = new Date(Date.UTC(ay, 2, 31, 15, 0, 0)); // X 年 3月31日 15:00 UTC = 4月1日 JST
  const to = new Date(Date.UTC(ay + 1, 2, 31, 15, 0, 0));

  const result = await prisma.academicEvent.deleteMany({
    where: { date: { gte: from, lt: to } },
  });

  return NextResponse.json({ ok: true, deleted: result.count, academicYear: ay });
}
