// 今日の授業ブロックと各コマの出席状況を返す (UI 用)。
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";
import { prisma } from "@/lib/db";
import {
  getTodayClasses,
  getAttendanceMode,
  hasCitCredentials,
} from "@/lib/attendance/service";
import { blockRowIds } from "@/lib/attendance/blocks";
import { getNoQrCourses, noQrRoomId } from "@/lib/attendance/noQr";
import { getJstParts, hhmmToMinutes, isInConfirmWindow } from "@/lib/attendance/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const now = new Date();
  const jst = getJstParts(now);
  const [classes, mode, hasCreds, noQrCourses] = await Promise.all([
    getTodayClasses(now),
    getAttendanceMode(),
    hasCitCredentials(),
    getNoQrCourses(),
  ]);

  const rows = classes.map((c) => ({ id: c.id, courseName: c.courseName, period: c.period }));

  // 今日の成功/手動ログ (ブロック単位の「出席済み」判定に使う)
  const doneLogs = await prisma.attendanceLog.findMany({
    where: {
      classScheduleId: { in: classes.map((c) => c.id) },
      classDate: jst.ymd,
      status: { in: ["success", "manual"] },
    },
    select: { classScheduleId: true },
  });
  const doneIds = new Set(doneLogs.map((l) => l.classScheduleId));

  const items = classes.map((c) => {
    const block = blockRowIds(rows, c.id);
    const blockDone = block.some((id) => doneIds.has(id));
    const startMinutes = hhmmToMinutes(c.startTime);
    const inWindow =
      startMinutes !== null && isInConfirmWindow(now, c.dayOfWeek, startMinutes);
    const noQr = noQrCourses.find((n) => n.courseName === c.courseName);
    return {
      id: c.id,
      period: c.period,
      endPeriod: c.endPeriod,
      courseName: c.courseName,
      classroom: c.classroom,
      startTime: c.startTime,
      endTime: c.endTime,
      blockHead: block[0] === c.id,
      done: blockDone,
      inWindow,
      // QR なし送信を許可した授業か。許可していても教室番号が分からなければ noQrRoom は null
      noQr: !!noQr,
      noQrRoom: noQr ? noQrRoomId(noQr, c.classroom) : null,
    };
  });

  return NextResponse.json({ ok: true, date: jst.ymd, mode, hasCreds, classes: items });
}
