// 内部 cron 用の manaba 同期エンドポイント。JOBS_TOKEN 認証。
// 実体は /api/manaba/sync と同じく runManabaSync()。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { runManabaSync } from "@/lib/manabaSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  const result = await runManabaSync();
  if (!result.ok) {
    // 認証情報未登録は cron 上は静かに(error 扱いせず)スキップ
    if (result.stage === "no-credential") {
      return NextResponse.json({ ok: false, skipped: true, reason: result.error });
    }
    const status = result.stage === "decrypt" ? 500 : 502;
    return NextResponse.json({ error: result.error, stage: result.stage }, { status });
  }
  return NextResponse.json(result);
}
