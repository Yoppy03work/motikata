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

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { weekStartOf as _w, isValidYmd as _v } from "@/lib/week";
import { matchesOn } from "@/lib/rrule";
void _w;
void _v;

export type ExpandResult = {
  ymd: string;
  isClassDay: boolean;
  classes: number;
  inserted: number;
  skipped: number;
  // RECURRING テンプレートからの展開分(常時カウント、授業日とは独立)
  recurringInserted: number;
  recurringSkipped: number;
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

  // 学年歴(ClassDay)が無い日はそもそも授業をしない。
  // ただし RECURRING テンプレート(毎日/毎週/毎月)は授業日と無関係に
  // 展開するので、isClassDay=false でも recurring 分は処理する。
  const dayStart = new Date(`${ymd}T00:00:00+09:00`);
  const dayEnd = new Date(`${ymd}T23:59:59+09:00`);
  const classDay = await prisma.classDay.findUnique({ where: { date: dayStart } });
  if (!classDay) {
    const r = await expandRecurringFor(ymd);
    return {
      ymd,
      isClassDay: false,
      classes: 0,
      inserted: 0,
      skipped: 0,
      recurringInserted: r.inserted,
      recurringSkipped: r.skipped,
    };
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
    const r = await expandRecurringFor(ymd);
    return {
      ymd,
      isClassDay: true,
      classes: 0,
      inserted: 0,
      skipped: 0,
      recurringInserted: r.inserted,
      recurringSkipped: r.skipped,
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

    try {
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
    } catch (e) {
      // (source, sourceExternalId) は @@unique なので、並行 expandToday が
      // 同時に走ると後発が P2002(unique violation)で落ちる。
      // 重複は仕様上「既に作られているのでスキップ」と等価なので、
      // 全体ジョブを 500 で止めず skipped に集計して続行する。
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        skipped++;
        continue;
      }
      throw e;
    }
  }

  const r = await expandRecurringFor(ymd);
  return {
    ymd,
    isClassDay: true,
    classes: schedules.length,
    inserted,
    skipped,
    recurringInserted: r.inserted,
    recurringSkipped: r.skipped,
  };
}

/**
 * RECURRING な TaskTemplate を ymd(JST)で評価して、マッチするものを
 * TaskInstance に展開する。重複は (source=RECURRING, sourceExternalId=
 * `recurring:<templateId>:<ymd>`) の unique 制約で防ぐ。
 *
 * dueAt は ymd の 00:00 JST + defaultDueOffsetMin で計算する。
 * (defaultDueOffsetMin が 60*9 なら 9:00、60*22 なら 22:00 等)
 */
async function expandRecurringFor(
  ymd: string,
): Promise<{ inserted: number; skipped: number }> {
  const templates = await prisma.taskTemplate.findMany({
    where: { kind: "RECURRING" },
    select: {
      id: true,
      title: true,
      notes: true,
      itemType: true,
      required: true,
      priority: true,
      defaultDueOffsetMin: true,
      rrule: true,
    },
  });

  let inserted = 0;
  let skipped = 0;
  const dayStartJst = new Date(`${ymd}T00:00:00+09:00`);

  for (const t of templates) {
    if (!matchesOn(t.rrule, ymd)) continue;
    const externalId = `recurring:${t.id}:${ymd}`;
    const dueAt = new Date(
      dayStartJst.getTime() + t.defaultDueOffsetMin * 60_000,
    );
    try {
      await prisma.taskInstance.create({
        data: {
          templateId: t.id,
          title: t.title,
          notes: t.notes,
          dueAt,
          itemType: t.itemType,
          required: t.required,
          priority: t.priority,
          status: "OPEN",
          source: "RECURRING",
          sourceExternalId: externalId,
        },
      });
      inserted++;
    } catch (e) {
      // 並行 expand-today / 既展開の場合は P2002 で重複拒否。skipped 扱いで続行。
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        skipped++;
        continue;
      }
      throw e;
    }
  }
  return { inserted, skipped };
}
