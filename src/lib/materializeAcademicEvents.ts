// AcademicEvent の行を、カレンダー/Today から見える TaskInstance(EVENT) に
// 「映す」共有ロジック。
//
// 背景:
//   /api/academic/import と /api/academic/import-cit は AcademicEvent には
//   書き込むが、UI 側の MonthCalendar / DayDetailSheet は TaskInstance しか
//   読まない(getMonthlyIndicators, /api/tasks)。そのため import は成功
//   報告するのに「カレンダーには何も出てこない」現象が起きていた。
//   AcademicEvent は classDays.ts が学期境界・休講判定で読むため残しつつ、
//   見せたい行だけを TaskInstance に複製する。
//
// 仕様:
//   - kind=HOLIDAY は除外(休講は授業 EVENT 側の非表示として既に効くだけで、
//     ユーザの「予定」セクションに並べたくない)
//   - itemType=EVENT, required=false, priority=LOW, status=OPEN
//   - source=ACADEMIC, sourceExternalId=`ics:<isoDate>:<title>` で
//     (source, sourceExternalId) ユニーク制約に乗せる → 再 import で
//     dedup される
//   - dueAt は AcademicEvent.date を JST 09:00 にずらして「朝の予定」として
//     並べる。終日扱いだが、Today 上で時刻表示があるので 9:00 が読みやすい。
//
// 戻り値: 新規に作成した TaskInstance の件数。

import { Prisma, type PrismaClient } from "@prisma/client";

export type MaterializableAcademicEvent = {
  title: string;
  date: Date;
  kind: "EXAM" | "HOLIDAY" | "EVENT";
};

type TxClient = Prisma.TransactionClient | PrismaClient;

export async function materializeAcademicEventsAsInstances(
  tx: TxClient,
  events: MaterializableAcademicEvent[],
): Promise<number> {
  const surfaceable = events.filter((e) => e.kind !== "HOLIDAY");
  if (surfaceable.length === 0) return 0;

  let created = 0;
  for (const e of surfaceable) {
    const externalId = `ics:${e.date.toISOString()}:${e.title}`;
    // JST 09:00 にシフト: e.date は JST 0:00 (UTC 前日 15:00) を表す Date。
    // そのまま +9h すると JST 09:00 = UTC 0:00。
    const dueAt = new Date(e.date.getTime() + 9 * 60 * 60 * 1000);

    // (source, sourceExternalId) は @@unique なので create で P2002 を
    // catch すれば dedup できる。先に findUnique しても race で抜けるので
    // 例外ベースで素朴に処理する。
    try {
      await tx.taskInstance.create({
        data: {
          title: e.title,
          dueAt,
          itemType: "EVENT",
          required: false,
          priority: "LOW",
          status: "OPEN",
          source: "ACADEMIC",
          sourceExternalId: externalId,
        },
      });
      created++;
    } catch (err) {
      // P2002 = (source, sourceExternalId) ユニーク制約違反 → 既に作成済み
      // (再 import)。dedup として握りつぶす。それ以外は再 throw。
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }
  return created;
}
