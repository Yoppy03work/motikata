// 学年歴 ICS インポート。
// 認証必須。Body は ICS テキスト全文(text/calendar or text/plain)。
// 仕様:
//   - VEVENT を抽出して AcademicEvent に bulk insert
//   - 同 (date, title) が既に DB にあればスキップ(de-dup)
//   - importedFrom: アップロード時の `ics` ラベル(将来は filename / source URL)

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { parseIcs } from "@/lib/parseIcs";
import { materializeAcademicEventsAsInstances } from "@/lib/materializeAcademicEvents";

export const runtime = "nodejs";
// Body 上限は CSP 経由で 2MB。学年歴 ICS は通常数十 KB なので十分。

const Body = z.object({
  text: z.string().min(8).max(2_000_000),
  source: z.string().max(120).optional(),
  // `dryRun: true` にすると DB に書かず、パース結果だけ返す(プレビュー用)
  dryRun: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const result = parseIcs(parsed.data.text);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const events = result.events;

  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: true,
      preview: events.map((e) => ({
        title: e.title,
        date: e.date.toISOString(),
        kind: e.kind,
      })),
      count: events.length,
    });
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, skipped: 0 });
  }

  // 既存 (date, title) を一括取得して重複スキップ
  const minDate = events.reduce((m, e) => (e.date < m ? e.date : m), events[0].date);
  const maxDate = events.reduce((m, e) => (e.date > m ? e.date : m), events[0].date);
  const existing = await prisma.academicEvent.findMany({
    where: { date: { gte: minDate, lte: maxDate } },
    select: { date: true, title: true },
  });
  const existingKey = new Set(
    existing.map((e) => `${e.date.toISOString()}|${e.title}`),
  );

  const fresh = events.filter(
    (e) => !existingKey.has(`${e.date.toISOString()}|${e.title}`),
  );

  // ここで早期 return しない: AcademicEvent は前回 import で入ったが、
  // materialize の途中で落ちて TaskInstance が片落ちしているケースを
  // 自己修復するため、fresh が空でも materialize は必ず実行する。
  // 旧版はここで return していたので、一度失敗した import は再 import
  // しても TaskInstance が永遠に作られないままだった。

  const source = (parsed.data.source ?? "ics").slice(0, 120);

  // AcademicEvent insert と TaskInstance 複製を 1 トランザクションに包む。
  // どちらかが失敗したら両方ロールバックされ、片落ちを作らない。
  const surfaced = await prisma.$transaction(async (tx) => {
    if (fresh.length > 0) {
      await tx.academicEvent.createMany({
        data: fresh.map((e) => ({
          title: e.title,
          date: e.date,
          kind: e.kind,
          importedFrom: source,
        })),
      });
    }
    // 重要: materialize には fresh ではなく events 全件を渡す。
    // (source, sourceExternalId) ユニーク制約で dedup されるので、既存に
    // 対しては no-op、欠けている行に対しては作成、という冪等動作になる。
    // 前回 import 後にもし TaskInstance が片落ちしていたなら、ここで
    // 自動的に追加される。
    return materializeAcademicEventsAsInstances(tx, events);
  });

  return NextResponse.json({
    ok: true,
    inserted: fresh.length,
    skipped: events.length - fresh.length,
    surfaced,
  });
}
