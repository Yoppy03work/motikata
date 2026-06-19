// GET /api/oauth/google/status
// Settings UI 表示用。連携の有無・email・最終同期時刻・直近エラーを返す。
// refresh_token は秘匿(返さない)。

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cred = await prisma.googleCredential.findUnique({
    where: { singletonKey: "default" },
    select: {
      email: true,
      lastSyncAt: true,
      lastError: true,
    },
  });
  if (!cred) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    email: cred.email,
    lastSyncAt: cred.lastSyncAt?.toISOString() ?? null,
    lastError: cred.lastError ?? null,
  });
}
