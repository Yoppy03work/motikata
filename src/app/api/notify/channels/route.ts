// 通知先の一覧(設定画面用)。webhook URL やトークンは返さない。
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";
import { listChannelStatus } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  return NextResponse.json({ ok: true, channels: await listChannelStatus() });
}
