// 出席モード (manual/confirm/auto) の取得・更新。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { getAttendanceMode, setAttendanceMode } from "@/lib/attendance/service";
import { attendanceModeSchema } from "@/lib/attendance/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const mode = await getAttendanceMode();
  return NextResponse.json({ ok: true, mode });
}

const PutBody = z.object({ mode: attendanceModeSchema });

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  await setAttendanceMode(parsed.data.mode);
  return NextResponse.json({ ok: true, mode: parsed.data.mode });
}
