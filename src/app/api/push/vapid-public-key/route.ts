// 公開 VAPID 鍵をフロントに渡す。Service Worker の subscribe で必要。
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";
import { getVapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  try {
    return NextResponse.json({ ok: true, publicKey: await getVapidPublicKey() });
  } catch {
    return NextResponse.json({ error: "VAPID 鍵を用意できませんでした" }, { status: 500 });
  }
}
