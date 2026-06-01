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
//   - source=ACADEMIC, sourceExternalId=`<idPrefix>:<isoDate>:<title>` で
//     (source, sourceExternalId) ユニーク制約に乗せる → 再 import で
//     dedup される。idPrefix は呼び出し元から渡す:
//       - 利用者 ICS import → "ics"
//       - 千葉工大 PDF import → "cit-gakunenreki"
//     これにより、各インポート経路は自分のプレフィクスだけを reconciliation
//     対象にできて、別経路の row を巻き添えで消さずに済む。
//   - dueAt は AcademicEvent.date を JST 09:00 にずらして「朝の予定」として
//     並べる。終日扱いだが、Today 上で時刻表示があるので 9:00 が読みやすい。
//
// 並行制御:
//   呼び出し元(import / import-cit)は $transaction の中でこの関数を呼ぶ。
//   旧版は create を 1 件ずつ走らせて P2002 を握りつぶしていたが、
//   Postgres は unique 違反でトランザクション全体を aborted 状態にするので、
//   その後に続く classDay.deleteMany や別の materialize 行が
//   "current transaction is aborted" で落ちる事故になっていた。
//   対策として createMany({ skipDuplicates: true }) を使う。Prisma は
//   Postgres 上で ON CONFLICT DO NOTHING に展開してくれるので、unique
//   制約違反でトランザクションを壊さずに dedup できる。
//
// 戻り値: 新規に作成した TaskInstance の件数。

import type { Prisma, PrismaClient } from "@prisma/client";

export type MaterializableAcademicEvent = {
  title: string;
  date: Date;
  kind: "EXAM" | "HOLIDAY" | "EVENT";
};

type TxClient = Prisma.TransactionClient | PrismaClient;

export async function materializeAcademicEventsAsInstances(
  tx: TxClient,
  events: MaterializableAcademicEvent[],
  options: { idPrefix?: string } = {},
): Promise<number> {
  const idPrefix = options.idPrefix ?? "ics";
  const surfaceable = events.filter((e) => e.kind !== "HOLIDAY");
  if (surfaceable.length === 0) return 0;

  const data = surfaceable.map((e) => {
    const externalId = `${idPrefix}:${e.date.toISOString()}:${e.title}`;
    // JST 09:00 にシフト: e.date は JST 0:00 (UTC 前日 15:00) を表す Date。
    // そのまま +9h すると JST 09:00 = UTC 0:00。
    const dueAt = new Date(e.date.getTime() + 9 * 60 * 60 * 1000);
    return {
      title: e.title,
      dueAt,
      itemType: "EVENT" as const,
      required: false,
      priority: "LOW" as const,
      status: "OPEN" as const,
      source: "ACADEMIC" as const,
      sourceExternalId: externalId,
    };
  });

  const res = await tx.taskInstance.createMany({
    data,
    skipDuplicates: true,
  });
  return res.count;
}
