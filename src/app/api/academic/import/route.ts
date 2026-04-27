// 学事暦 ICS インポート。
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

export const runtime = "nodejs";
// Body 上限は CSP 経由で 2MB。学事暦 ICS は通常数十 KB なので十分。

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

  if (fresh.length === 0) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      skipped: events.length,
    });
  }

  const source = (parsed.data.source ?? "ics").slice(0, 120);
  await prisma.academicEvent.createMany({
    data: fresh.map((e) => ({
      title: e.title,
      date: e.date,
      kind: e.kind,
      importedFrom: source,
    })),
  });

  return NextResponse.json({
    ok: true,
    inserted: fresh.length,
    skipped: events.length - fresh.length,
  });
}
