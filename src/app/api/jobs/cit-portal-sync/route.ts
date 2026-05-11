// 内部 cron 用の CITポータル時間割同期エンドポイント。JOBS_TOKEN 認証。
// 実体は /api/cit-portal/sync と同じく runCitPortalSync()。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { runCitPortalSync } from "@/lib/citPortalSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  const result = await runCitPortalSync();
  if (!result.ok) {
    // 認証情報未登録は cron 上は静かに(error 扱いせず)スキップ
    if (result.stage === "no-credential") {
      return NextResponse.json({ ok: false, skipped: true, reason: result.error });
    }
    const status =
      result.stage === "decrypt" || result.stage === "db" ? 500 : 502;
    return NextResponse.json(
      { error: result.error, stage: result.stage },
      { status },
    );
  }
  return NextResponse.json(result);
}
