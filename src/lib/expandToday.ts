// 今日(JST)の授業を TaskInstance に自動展開する。
//
// 仕様:
//   1. ClassDay にその日が登録されていない(=授業日でない)なら何もしない
//   2. ClassSchedule で dayOfWeek が一致する全行を対象
//      - effectiveFrom / effectiveTo 範囲外はスキップ
//   3. 同じ (templateId === null + 同 source=CLASS + 同 dueAt) で
//      既存があれば作らない(冪等)
//   4. 各授業に対し:
//      - title = courseName + (classroom があれば " @<教室>")
//      - itemType = EVENT、required = false、source = CLASS
//      - dueAt = 今日の startTime (JST)
//      - sourceExternalId = `class:<scheduleId>:<ymd>` で重複検知
//      - ChecklistTemplate (ownerType=CLASS, ownerId=schedule.id) を
//        TaskInstanceCheck にコピー(持ち物リスト)

import { prisma } from "@/lib/db";
import { weekStartOf as _w, isValidYmd as _v } from "@/lib/week";
void _w;
void _v;

export type ExpandResult = {
  ymd: string;
  isClassDay: boolean;
  classes: number;
  inserted: number;
  skipped: number;
};

function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 10);
}

function jstDow(ymd: string): number {
  // ymd を JST 文脈で読んで曜日を返す。日=0 ... 月=1 ... 土=6。
  // ClassSchedule.dayOfWeek は 1=月..7=日 を想定するので変換も提供
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getDay(); // 0=日, 1=月, ..., 6=土
}

function jstDowToClassDow(dow: number): number {
  // 1=月..6=土, 7=日 で揃える(ClassSchedule の慣習に合わせる)
  return dow === 0 ? 7 : dow;
}

/** ymd の startTime (JST) → UTC instant に変換。 */
function toJstDateTime(ymd: string, hhmm: string): Date {
  return new Date(`${ymd}T${hhmm}:00+09:00`);
}

/**
 * 指定日(JST 文脈の "YYYY-MM-DD")を expand する。
 * 既定では引数なしで呼び出すと「JST の今日」を対象にする。
 */
export async function expandToday(targetYmd?: string): Promise<ExpandResult> {
  const ymd = targetYmd ?? jstYmd(new Date());

  // 学年歴(ClassDay)が無い日はそもそも授業をしない
  const dayStart = new Date(`${ymd}T00:00:00+09:00`);
  const dayEnd = new Date(`${ymd}T23:59:59+09:00`);
  const classDay = await prisma.classDay.findUnique({ where: { date: dayStart } });
  if (!classDay) {
    return { ymd, isClassDay: false, classes: 0, inserted: 0, skipped: 0 };
  }

  const classDow = jstDowToClassDow(jstDow(ymd));
  const schedules = await prisma.classSchedule.findMany({
    where: {
      dayOfWeek: classDow,
      AND: [
        {
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: dayEnd } }],
        },
        {
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: dayStart } }],
        },
      ],
    },
  });

  if (schedules.length === 0) {
    return {
      ymd,
      isClassDay: true,
      classes: 0,
      inserted: 0,
      skipped: 0,
    };
  }

  // 各 schedule の持ち物テンプレを一括取得
  const scheduleIds = schedules.map((s) => s.id);
  const checkTemplates = await prisma.checklistTemplate.findMany({
    where: { ownerType: "CLASS", ownerId: { in: scheduleIds } },
    orderBy: [{ ownerId: "asc" }, { orderIdx: "asc" }],
  });
  const checkByOwner = new Map<number, typeof checkTemplates>();
  for (const c of checkTemplates) {
    if (!checkByOwner.has(c.ownerId)) checkByOwner.set(c.ownerId, []);
    checkByOwner.get(c.ownerId)!.push(c);
  }

  let inserted = 0;
  let skipped = 0;

  for (const s of schedules) {
    const externalId = `class:${s.id}:${ymd}`;
    const existing = await prisma.taskInstance.findFirst({
      where: { source: "CLASS", sourceExternalId: externalId },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const dueAt = toJstDateTime(ymd, s.startTime);
    const titleSuffix = s.classroom ? ` @${s.classroom}` : "";
    const checks = checkByOwner.get(s.id) ?? [];

    await prisma.taskInstance.create({
      data: {
        title: `${s.courseName}${titleSuffix}`,
        notes: s.teacher ? `担当: ${s.teacher}` : null,
        dueAt,
        itemType: "EVENT",
        required: false,
        priority: "MID",
        status: "OPEN",
        source: "CLASS",
        sourceExternalId: externalId,
        checklist:
          checks.length > 0
            ? {
                create: checks.map((c, i) => ({
                  label: c.label,
                  orderIdx: c.orderIdx ?? i,
                })),
              }
            : undefined,
      },
    });
    inserted++;
  }

  return {
    ymd,
    isClassDay: true,
    classes: schedules.length,
    inserted,
    skipped,
  };
}
