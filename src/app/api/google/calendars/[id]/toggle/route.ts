// POST /api/google/calendars/[id]/toggle
// body: { enabled: boolean }
// 指定した GoogleCalendar の enabled を切り替える。
// disabled に倒すと、次回 sync で events.list がスキップされる。
// (= モチカタ上に残った既存 TaskInstance は維持される; 必要なら別ボタンで一括削除する)

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session.authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const calendarId = Number(id);
  if (!Number.isInteger(calendarId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }
  try {
    const updated = await prisma.googleCalendar.update({
      where: { id: calendarId },
      data: { enabled: body.enabled },
      select: { id: true, enabled: true, summary: true },
    });
    return NextResponse.json({ ok: true, calendar: updated });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
