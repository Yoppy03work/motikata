// 内部 cron 用の Google カレンダー同期エンドポイント。JOBS_TOKEN 認証。
// 実体は syncGoogleCalendar()。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { syncGoogleCalendar } from "@/lib/googleCalendarSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  const result = await syncGoogleCalendar();
  if (!result.ok) {
    // Google 未連携は cron 上は静かに skip (error 扱いしない)
    if (result.error === "Google カレンダー未連携") {
      return NextResponse.json({ ok: false, skipped: true, reason: result.error });
    }
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result);
}
