// CITポータル時間割同期エンドポイント(ユーザ手動トリガー)。
// セッション認証のみ。実体ロジックは @/lib/citPortalSync に集約。

import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";
import { runCitPortalSync } from "@/lib/citPortalSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// SSO + MFA + ViewState のラウンドトリップが多いので、長めに取る
export const maxDuration = 120;

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const result = await runCitPortalSync();
  if (!result.ok) {
    const status =
      result.stage === "no-credential"
        ? 400
        : result.stage === "decrypt"
          ? 500
          : result.stage === "db"
            ? 500
            : 502;
    return NextResponse.json(
      { error: result.error, stage: result.stage },
      { status },
    );
  }
  return NextResponse.json(result);
}
