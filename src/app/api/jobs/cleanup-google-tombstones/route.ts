// 内部 cron 用。expire した GoogleTombstone を物理削除する。
// JOBS_TOKEN 認証。1 日 1 回程度の頻度で十分。
//
// 30 日経過しているなら、Google 側でも events.delete に到達する時間は
// 十分あったはずで、tombstone を維持する理由が無い。
// 万が一 Google 側で復活させた場合は、tombstone が消えるので次回 sync で
// 普通に取り込まれる (期待動作)。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  const now = new Date();
  const result = await prisma.googleTombstone.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}
