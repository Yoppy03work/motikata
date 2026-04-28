// manaba 課題同期エンドポイント(ユーザ手動トリガー)。
// セッション認証のみ。実体ロジックは @/lib/manabaSync に集約。

import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";
import { runManabaSync } from "@/lib/manabaSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const result = await runManabaSync();
  if (!result.ok) {
    const status = result.stage === "no-credential" ? 400 : result.stage === "decrypt" ? 500 : 502;
    return NextResponse.json({ error: result.error, stage: result.stage }, { status });
  }
  return NextResponse.json(result);
}
