// 内部 cron 用の auto 出席ティック。JOBS_TOKEN 認証。
// フェーズ A では ATTENDANCE_AUTO_EXECUTION_ENABLED 未設定のため、guard で skipped に倒れ
// 監査ログを残すだけで一切送信しない (dark)。フェーズ B の env 解禁で実送信が生きる。
import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { runAutoTick } from "@/lib/attendance/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  const result = await runAutoTick();
  return NextResponse.json({ ok: true, ...result });
}
