// 出席モード (manual/confirm/auto) の取得・更新。
// auto は開発者コード (env ATTENDANCE_AUTO_DEV_CODE) を入力したときだけ解禁できる。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { getAttendanceSettings, setAttendanceMode } from "@/lib/attendance/service";
import { attendanceModeSchema } from "@/lib/attendance/settings";
import { isAutoDevCodeConfigured, verifyAutoDevCode } from "@/lib/attendance/rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const s = await getAttendanceSettings();
  // autoConfigured: 開発者コードが設定されているか (UI が auto を出すか判断する)。
  return NextResponse.json({
    ok: true,
    mode: s.mode,
    autoUnlocked: s.autoUnlocked,
    autoConfigured: isAutoDevCodeConfigured(),
  });
}

const PutBody = z.object({
  mode: attendanceModeSchema,
  devCode: z.string().max(200).optional(),
});

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (parsed.data.mode === "auto") {
    // auto は開発者コード検証に通ったときだけ解禁。未設定/不一致は 403 (fail-closed)。
    if (!isAutoDevCodeConfigured()) {
      return NextResponse.json(
        { error: "auto_locked", message: "auto は無効です (開発者コード未設定)" },
        { status: 403 },
      );
    }
    if (!parsed.data.devCode || !verifyAutoDevCode(parsed.data.devCode)) {
      return NextResponse.json(
        { error: "bad_dev_code", message: "開発者コードが違います" },
        { status: 403 },
      );
    }
    await setAttendanceMode("auto", true);
    return NextResponse.json({ ok: true, mode: "auto" });
  }

  await setAttendanceMode(parsed.data.mode, false);
  return NextResponse.json({ ok: true, mode: parsed.data.mode });
}
