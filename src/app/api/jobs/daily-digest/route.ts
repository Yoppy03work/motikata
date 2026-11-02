// 締切のまとめ通知。worker が毎分叩き、設定した時刻を過ぎていて未送信なら送る。
// JOBS_TOKEN 必須。
import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { runDailyDigest } from "@/lib/dailyDigest";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  try {
    const result = await runDailyDigest();
    if (result.kind === "not-due") return NextResponse.json({ ok: true });
    return NextResponse.json({
      ok: result.kind !== "failed",
      ...result,
      sent: result.kind === "sent" ? 1 : 0,
      skipped: result.kind === "skipped" || result.kind === "empty" ? 1 : 0,
      failed: result.kind === "failed" ? 1 : 0,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "digest failed" }, { status: 500 });
  }
}
