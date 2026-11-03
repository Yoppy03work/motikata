// 「QR なしで送信」の設定。
//   GET: オン/オフ・教室ごとの手入力と、今学期の時間割にある教室の一覧 (作れる教室番号つき)
//   PUT: { all, rooms } をまるごと保存する
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/authGuard";
import { prisma } from "@/lib/db";
import { NoQrSettings, deriveRoomId, getNoQrSettings, setNoQrSettings } from "@/lib/attendance/noQr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const now = new Date();
  const [rows, settings] = await Promise.all([
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
    getNoQrSettings(),
  ]);
  const byRoom = new Map<string, string[]>();
  for (const r of rows) {
    const room = r.classroom?.trim();
    if (!room) continue;
    const names = byRoom.get(room) ?? [];
    if (!names.includes(r.courseName)) names.push(r.courseName);
    byRoom.set(room, names);
  }
  const classrooms = [...byRoom].map(([classroom, courses]) => ({
    classroom,
    courses,
    derivedRoomId: deriveRoomId(classroom),
  }));
  return NextResponse.json({ ok: true, ...settings, classrooms });
}

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = NoQrSettings.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "入力が正しくありません";
    return NextResponse.json({ error: "invalid body", message }, { status: 400 });
  }
  await setNoQrSettings(parsed.data);
  return NextResponse.json({ ok: true, ...parsed.data });
}
