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
import { Prisma } from "@prisma/client";
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
      } catch (e) {
        // 期待される race だけ skip 集計に倒し、それ以外は 500 に上げる。
        // - P2002: 並行 escalate(手動 + cron 等)で同じ dedupeKey が
        //   既に挿入された → 期待通り、skipped 扱い。
        // - P2003: タスク行が同 tick 内に消された → 起こり得るので skipped。
        // それ以外の Prisma エラーや接続エラーは黙って飲み込むと「成功して
        // 0 件 scheduled」のように見えて、その日の朝通知が全タスク分
        // 抜けたまま worker は次の cron まで再試行しない。500 に上げて
        // worker のログに残し、人間に気付かせる。
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          (e.code === "P2002" || e.code === "P2003")
        ) {
          skipped++;
          continue;
        }
        throw e;
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
