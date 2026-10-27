// POST /api/oauth/google/sync-now
// ユーザー操作 (Settings UI のボタン) で即時同期を回す。
// 認可必須 (セッションログイン中)。

import { NextResponse } from "next/server";
import { getSession, isSessionValid } from "@/lib/auth";
import { syncGoogleCalendar } from "@/lib/googleCalendarSync";

export async function POST() {
  const session = await getSession();
  if (!(await isSessionValid(session))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncGoogleCalendar();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
