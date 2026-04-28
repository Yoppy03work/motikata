// 締切が過ぎた TaskInstance(itemType=TASK のみ)を削除する。
// 予定 (EVENT) は対象外なので、文化の祭典・津田沼祭・授業日由来の行事は残る。
// JOBS_TOKEN 必須(worker から毎日叩かれる)。
//
// 関連する Reminder / TaskInstanceCheck / TaskInstanceTag は
// schema の onDelete: Cascade で自動削除される。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireJobsToken } from "@/lib/jobsAuth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;

  const now = new Date();
  const result = await prisma.taskInstance.deleteMany({
    where: {
      itemType: "TASK",
      dueAt: { lt: now },
    },
  });
  return NextResponse.json({
    ok: true,
    deleted: result.count,
    asOf: now.toISOString(),
  });
}
