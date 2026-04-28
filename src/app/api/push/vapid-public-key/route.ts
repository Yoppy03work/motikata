// 公開 VAPID 鍵をフロントに渡す。Service Worker の subscribe で必要。
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const key = process.env.VAPID_PUBLIC_KEY ?? "";
  if (!key) {
    return NextResponse.json({ error: "VAPID_PUBLIC_KEY が未設定です" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, publicKey: key });
}
