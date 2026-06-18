// GET /api/google/calendars
// 連携済み Google アカウントの GoogleCalendar 一覧を返す。
// UI で enable/disable トグルに使う。連携前は空配列。

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
    select: { id: true },
  });
  if (!cred) return NextResponse.json({ calendars: [] });
  const calendars = await prisma.googleCalendar.findMany({
    where: { credentialId: cred.id },
    orderBy: [{ isPrimary: "desc" }, { summary: "asc" }],
    select: {
      id: true,
      summary: true,
      isPrimary: true,
      colorHex: true,
      enabled: true,
      lastSyncAt: true,
      lastError: true,
    },
  });
  return NextResponse.json({
    calendars: calendars.map((c) => ({
      ...c,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    })),
  });
}
