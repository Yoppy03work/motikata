// 内部 cron(worker)から叩くリマインダー配信エンドポイント。
// JOBS_TOKEN 必須。middleware で /api/jobs/* は CSRF / セッション認証から除外済み。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { dispatchPendingReminders } from "@/lib/dispatchReminders";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;

  try {
    const summary = await dispatchPendingReminders();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "dispatch failed",
      },
      { status: 500 },
    );
  }
}
