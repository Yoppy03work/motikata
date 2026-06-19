// 完了率統計 API。
// クエリ: range=week|month(既定 week)
// 返す: 期間内の TaskInstance を集計した数値群。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { weekStartOf, weekDates } from "@/lib/week";

export const dynamic = "force-dynamic";

function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const url = new URL(req.url);
  const range = url.searchParams.get("range") === "month" ? "month" : "week";

  const todayYmd = jstYmd(new Date());
  let fromYmd: string;
  let toYmd: string;
  if (range === "week") {
    const monday = weekStartOf(todayYmd);
    const days = weekDates(monday);
    fromYmd = days[0];
    toYmd = days[6];
  } else {
    // 当月 1日 〜 末日 (JST)
    const [y, m] = todayYmd.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    fromYmd = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`;
    toYmd = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
  }
  const from = new Date(`${fromYmd}T00:00:00+09:00`);
  const to = new Date(`${toYmd}T23:59:59+09:00`);

  const rows = await prisma.taskInstance.findMany({
    where: {
      itemType: "TASK",
      dueAt: { gte: from, lte: to },
    },
    select: { status: true, priority: true, required: true, dueAt: true },
  });

  const total = rows.length;
  const done = rows.filter((r) => r.status === "DONE").length;
  const skipped = rows.filter((r) => r.status === "SKIPPED").length;
  const open = rows.filter((r) => r.status === "OPEN").length;
  const requiredOpen = rows.filter((r) => r.status === "OPEN" && r.required).length;
  const doneRate = total > 0 ? Math.round((done / total) * 100) : 0;

  const byPriority = {
    HIGH: rows.filter((r) => r.priority === "HIGH").length,
    MID: rows.filter((r) => r.priority === "MID").length,
    LOW: rows.filter((r) => r.priority === "LOW").length,
  };
  const doneByPriority = {
    HIGH: rows.filter((r) => r.priority === "HIGH" && r.status === "DONE").length,
    MID: rows.filter((r) => r.priority === "MID" && r.status === "DONE").length,
    LOW: rows.filter((r) => r.priority === "LOW" && r.status === "DONE").length,
  };

  // 累積未完了 (期限が過去で OPEN)
  const overdue = await prisma.taskInstance.count({
    where: {
      itemType: "TASK",
      status: "OPEN",
      dueAt: { lt: new Date() },
    },
  });

  return NextResponse.json({
    ok: true,
    range,
    fromYmd,
    toYmd,
    total,
    done,
    skipped,
    open,
    requiredOpen,
    doneRate,
    byPriority,
    doneByPriority,
    overdue,
  });
}
