// QR スキャン → 検証済み出席セッション (AttendanceQrSession) を作る。
// auto モード (フェーズ B) の在席証明に使う。フェーズ A では作成するだけで消費されない。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { prisma } from "@/lib/db";
import { parseAttendanceQrUrl } from "@/lib/attendance/qr";
import { attendanceRoomMatches } from "@/lib/attendance/room-normalize";
import { getJstParts } from "@/lib/attendance/time";
import { getTodayClasses } from "@/lib/attendance/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CTP と同じく QR セッション TTL = 150 分 (同日の連続コマをカバー)。
const SESSION_TTL_MS = 150 * 60 * 1000;

const Body = z.object({
  qr: z.string().min(1).max(2048),
  classScheduleId: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const qr = parseAttendanceQrUrl(parsed.data.qr);
  if (!qr.ok) {
    return NextResponse.json({ error: "invalid_qr", reason: qr.reason }, { status: 400 });
  }

  const now = new Date();
  const jst = getJstParts(now);

  // classScheduleId が明示されていればそれを、無ければ今日の授業から教室一致で解決する。
  let classScheduleId: number | null = parsed.data.classScheduleId ?? null;
  if (classScheduleId === null) {
    const today = await getTodayClasses(now);
    const match = today.find((c) => attendanceRoomMatches(c.classroom, qr.roomId));
    classScheduleId = match?.id ?? null;
  }

  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.attendanceQrSession.upsert({
    where: { roomId_classDate: { roomId: qr.roomId, classDate: jst.ymd } },
    create: { roomId: qr.roomId, classDate: jst.ymd, classScheduleId, expiresAt },
    update: { classScheduleId, expiresAt, consumedAt: null },
  });

  return NextResponse.json({ ok: true, roomId: qr.roomId, classScheduleId });
}
