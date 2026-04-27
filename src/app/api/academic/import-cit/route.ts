// 千葉工業大学 学生資料室の学年歴 PDF を取りに行って AcademicEvent に流す。
// dryRun=true でプレビュー、false で重複スキップしつつ DB に書き込む。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { parseCitGakunenreki } from "@/lib/parseCitGakunenreki";
import { SETTING_KEY_LAST_FETCH } from "@/lib/academicSettings";

export const runtime = "nodejs";
// PDF パースは pdfjs-dist の都合で Node ランタイム必須
export const dynamic = "force-dynamic";
// PDF 取得 + パースに数秒かかることがある
export const maxDuration = 30;

const Body = z.object({
  dryRun: z.boolean().optional(),
});

const SOURCE_TAG = "cit-gakunenreki";

async function recordLastFetch(
  academicYear: number,
  inserted: number,
  skipped: number,
): Promise<void> {
  const value = {
    ts: new Date().toISOString(),
    academicYear,
    inserted,
    skipped,
  };
  await prisma.setting.upsert({
    where: { key: SETTING_KEY_LAST_FETCH },
    create: { key: SETTING_KEY_LAST_FETCH, value },
    update: { value },
  });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  let result;
  try {
    result = await parseCitGakunenreki();
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "千葉工大 学年歴の取得 / パースに失敗しました",
      },
      { status: 502 },
    );
  }
  const { academicYear, events } = result;

  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: true,
      academicYear,
      preview: events.map((e) => ({
        title: e.title,
        date: e.date.toISOString(),
        kind: e.kind,
      })),
      count: events.length,
    });
  }

  if (events.length === 0) {
    return NextResponse.json({
      ok: true,
      academicYear,
      inserted: 0,
      skipped: 0,
    });
  }

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
    await recordLastFetch(academicYear, 0, events.length);
    return NextResponse.json({
      ok: true,
      academicYear,
      inserted: 0,
      skipped: events.length,
    });
  }

  await prisma.academicEvent.createMany({
    data: fresh.map((e) => ({
      title: e.title,
      date: e.date,
      kind: e.kind,
      importedFrom: SOURCE_TAG,
    })),
  });
  await recordLastFetch(academicYear, fresh.length, events.length - fresh.length);

  return NextResponse.json({
    ok: true,
    academicYear,
    inserted: fresh.length,
    skipped: events.length - fresh.length,
  });
}
