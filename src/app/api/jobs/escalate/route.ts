// 「当日未終了」タスクの朝再通知。
//
// 仕様:
//   - 対象: 今日(JST)の 0:00〜23:59 に dueAt が入っていて、status=OPEN の TaskInstance
//   - itemType=TASK のみ(EVENT は対象外)
//   - 各タスクに対し、即時発火する Reminder (channel=PUSH, escalationLevel=1) を1件追加
//     dispatchReminders cron(毎分)が拾って Push を送る
//   - dedupeKey で重複防止: "esc:<instanceId>:<ymd>"
//
// JOBS_TOKEN 認証。worker cron が毎朝 7:00 JST に叩く想定。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireJobsToken } from "@/lib/jobsAuth";

export const dynamic = "force-dynamic";

function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const ymd = url.searchParams.get("ymd") ?? jstYmd(new Date());
    const dayStart = new Date(`${ymd}T00:00:00+09:00`);
    const dayEnd = new Date(`${ymd}T23:59:59+09:00`);

    const opens = await prisma.taskInstance.findMany({
      where: {
        itemType: "TASK",
        status: "OPEN",
        dueAt: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });
    if (opens.length === 0) {
      return NextResponse.json({ ok: true, ymd, scanned: 0, scheduled: 0 });
    }

    const now = new Date();
    let scheduled = 0;
    let skipped = 0;
    for (const t of opens) {
      const dedupeKey = `esc:${t.id}:${ymd}`;
      const existing = await prisma.reminder.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      try {
        await prisma.reminder.create({
          data: {
            instanceId: t.id,
            remindAt: now,
            channel: "PUSH",
            escalationLevel: 1,
            status: "PENDING",
            dedupeKey,
          },
        });
        scheduled++;
      } catch {
        skipped++;
      }
    }
    return NextResponse.json({
      ok: true,
      ymd,
      scanned: opens.length,
      scheduled,
      skipped,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "escalate failed" },
      { status: 500 },
    );
  }
}
