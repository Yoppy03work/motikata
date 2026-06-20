// Phase 14e: 日次 cron 用。各種同期 (manaba / CIT / Google) の lastError を
// Slack で 1 通にまとめて通知する。JOBS_TOKEN 認証。
//
// 設計:
// - エラーゼロなら通知しない (静かな成功)
// - Slack 未設定なら no-op
// - スパム抑制は cron 頻度 (daily) で十分
// - 失敗状態は cron では復旧しないので、毎日同じ通知が来る前提
//   (= ユーザーに「同じエラーが続いている」のシグナルになる)

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { runSyncFailureAlert } from "@/lib/syncHealthAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  const result = await runSyncFailureAlert();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result);
}
