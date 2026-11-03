// 「QR なしで送信」を許可する授業の一覧と更新。
//   GET: 今学期の授業 (授業名ごと) と、許可済みの授業
//   PUT: 許可する授業の一覧をまるごと保存する (許可した日時は既存のものを引き継ぐ)
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { prisma } from "@/lib/db";
import {
  MAX_NO_QR_COURSES,
  NoQrCourse,
  deriveRoomId,
  getNoQrCourses,
  setNoQrCourses,
} from "@/lib/attendance/noQr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const now = new Date();
  const [rows, enabled] = await Promise.all([
    prisma.classSchedule.findMany({
      where: {
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
      select: { courseName: true, classroom: true },
    }),
    getNoQrCourses(),
  ]);
  const seen = new Set<string>();
  const courses = rows.flatMap((r) => {
    if (seen.has(r.courseName)) return [];
    seen.add(r.courseName);
    return [{ courseName: r.courseName, classroom: r.classroom, derivedRoomId: deriveRoomId(r.classroom) }];
  });
  return NextResponse.json({ ok: true, courses, enabled });
}

const PutBody = z.object({
  courses: z.array(NoQrCourse.omit({ enabledAt: true })).max(MAX_NO_QR_COURSES),
});

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "入力が正しくありません";
    return NextResponse.json({ error: "invalid body", message }, { status: 400 });
  }
  const prev = new Map((await getNoQrCourses()).map((c) => [c.courseName, c.enabledAt]));
  const nowIso = new Date().toISOString();
  const seen = new Set<string>();
  const list = parsed.data.courses
    .filter((c) => !seen.has(c.courseName) && seen.add(c.courseName))
    .map((c) => ({ ...c, enabledAt: prev.get(c.courseName) ?? nowIso }));
  await setNoQrCourses(list);
  return NextResponse.json({ ok: true, enabled: list });
}
