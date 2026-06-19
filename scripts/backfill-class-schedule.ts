// 保存済みの時間割サンプルHTML(tmp/timetable-sample.html)から
// ClassSchedule を effectiveFrom/effectiveTo 込みで再構築する。
// CIT portal sync が安定するまでの暫定。
//
// 実行:
//   set -a; source .env; set +a
//   DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}?schema=public" \
//     npx tsx scripts/backfill-class-schedule.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseTimetableHtml } from "@/lib/citPortalScrape";

const SAMPLE = resolve(process.cwd(), "tmp/timetable-sample.html");

async function main() {
  const html = readFileSync(SAMPLE, "utf8");
  const classes = parseTimetableHtml(html);
  console.log(`parsed ${classes.length} entries`);

  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.classSchedule.findMany({ select: { id: true } });
      const existingIds = existing.map((r) => r.id);
      console.log(`deleting ${existingIds.length} existing rows`);
      if (existingIds.length > 0) {
        await tx.checklistTemplate.deleteMany({
          where: { ownerType: "CLASS", ownerId: { in: existingIds } },
        });
        await tx.classSchedule.deleteMany({
          where: { id: { in: existingIds } },
        });
      }
      await tx.classSchedule.createMany({
        data: classes.map((c) => ({
          dayOfWeek: c.dayOfWeek,
          period: c.period,
          endPeriod: c.endPeriod,
          startTime: c.startTime,
          endTime: c.endTime,
          courseName: c.courseName,
          classroom: c.classroom,
          teacher: c.teacher,
          effectiveFrom: c.effectiveFrom,
          effectiveTo: c.effectiveTo,
          importedFrom: "cit-portal",
        })),
      });
    });
    console.log("done");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
