// 今日の授業を TaskInstance に展開する内部ジョブ。
// JOBS_TOKEN 認証。worker cron が毎朝 5:00 JST に叩く想定。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { expandToday } from "@/lib/expandToday";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  try {
    // クエリ ?ymd=YYYY-MM-DD で日付を任意指定可(デバッグ用)
    const url = new URL(req.url);
    const ymd = url.searchParams.get("ymd") ?? undefined;
    const result = await expandToday(ymd);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "expand-today failed" },
      { status: 500 },
    );
  }
}
