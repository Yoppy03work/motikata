// 千葉工業大学 学生資料室の学年歴 PDF を取りに行って AcademicEvent + ClassDay に流す。
// 仕様:
//   - パース結果は全部使って ClassDay を計算 (学期境界 + 休講 + 祝日授業日)
//   - AcademicEvent には「文化の祭典」と「津田沼祭」を含むイベントだけ persist
//     (履修登録期間や前期授業開始 などはノイズになるので残さない)
//   - 学年度範囲の ClassDay は再インポート時に「全削除 → 入れ直し」で同期

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { parseCitGakunenreki } from "@/lib/parseCitGakunenreki";
import { SETTING_KEY_LAST_FETCH } from "@/lib/academicSettings";
import { computeClassDaysFromEvents } from "@/lib/classDays";

export const runtime = "nodejs";
// PDF パースは pdfjs-dist の都合で Node ランタイム必須
export const dynamic = "force-dynamic";
// PDF 取得 + パースに数秒かかることがある
export const maxDuration = 30;

const Body = z.object({
  dryRun: z.boolean().optional(),
});

const SOURCE_TAG = "cit-gakunenreki";

// AcademicEvent として残すイベントのフィルタ。
// 「行事として通知に出てきてほしいもの」だけに絞る。
const KEEP_EXACT = new Set(["文化の祭典"]);
const KEEP_KEYWORDS = ["津田沼祭"];

function shouldKeepAsAcademicEvent(title: string): boolean {
  if (KEEP_EXACT.has(title)) return true;
  if (KEEP_KEYWORDS.some((k) => title.includes(k))) return true;
  return false;
}

async function recordLastFetch(
  academicYear: number,
  inserted: number,
  skipped: number,
  classDayCount: number,
): Promise<void> {
  const value = {
    ts: new Date().toISOString(),
    academicYear,
    inserted,
    skipped,
    classDayCount,
  };
  await prisma.setting.upsert({
    where: { key: SETTING_KEY_LAST_FETCH },
    create: { key: SETTING_KEY_LAST_FETCH, value },
    update: { value },
  });
}

// 学年度 X = X 年 4/1 0:00 JST 〜 (X+1) 年 4/1 0:00 JST 未満
// JST 4/1 0:00 = UTC (X) 年 3/31 15:00
function academicYearRange(ay: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(ay, 2, 31, 15, 0, 0));
  const end = new Date(Date.UTC(ay + 1, 2, 31, 15, 0, 0) - 1);
  return { start, end };
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

  // フィルタ後のイベントだけプレビューに出す(ユーザに見せるのは保持対象のみ)
  const keepEvents = events.filter((e) => shouldKeepAsAcademicEvent(e.title));
  // computeClassDaysFromEvents は対応年外(祝日テーブル未収載年)で
  // RangeError を投げる。それを 500 にせず 422 + 明示メッセージで返す。
  let classDays: Date[];
  try {
    classDays = computeClassDaysFromEvents(events);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof RangeError
            ? e.message
            : e instanceof Error
              ? `ClassDay 計算に失敗しました: ${e.message}`
              : "ClassDay 計算に失敗しました",
        academicYear,
        inserted: 0,
        skipped: 0,
        classDayInserted: 0,
        classDayDeleted: 0,
      },
      { status: 422 },
    );
  }

  if (parsed.data.dryRun) {
    return NextResponse.json({
      ok: true,
      academicYear,
      preview: keepEvents.map((e) => ({
        title: e.title,
        date: e.date.toISOString(),
        kind: e.kind,
      })),
      count: keepEvents.length,
      classDayCount: classDays.length,
    });
  }

  // 重要: classDays の空チェックは DB 書き込み前に行う。
  // PDF パースで学期境界マーカー(前期授業開始/終了 等)を取りこぼすと
  // classDays が空配列になる。その場合、replaceClassDays はその学年の既存
  // ClassDay を全消去して何も挿入しない=破壊的データ損失になるため、
  // この時点でエラー応答して以降の書き込みを行わない。
  if (classDays.length === 0) {
    return NextResponse.json(
      {
        error:
          "学期境界マーカーが PDF から検出できず、ClassDay を計算できませんでした。" +
          "既存の AcademicEvent / ClassDay は保護されます。" +
          "PDF レイアウト変更の可能性があるため、dryRun でプレビューを確認してください。",
        academicYear,
        inserted: 0,
        skipped: 0,
        classDayInserted: 0,
        classDayDeleted: 0,
      },
      { status: 422 },
    );
  }

  // 1) AcademicEvent + ClassDay を 1 トランザクションで書き込む。
  // 途中で例外が出れば全部ロールバックされ、部分的な不整合を残さない。
  let insertedEvents = 0;
  let skippedEvents = 0;
  const { start, end } = academicYearRange(academicYear);
  const cd = await prisma.$transaction(async (tx) => {
    if (keepEvents.length > 0) {
      const minDate = keepEvents.reduce(
        (m, e) => (e.date < m ? e.date : m),
        keepEvents[0].date,
      );
      const maxDate = keepEvents.reduce(
        (m, e) => (e.date > m ? e.date : m),
        keepEvents[0].date,
      );
      const existing = await tx.academicEvent.findMany({
        where: { date: { gte: minDate, lte: maxDate } },
        select: { date: true, title: true },
      });
      const existingKey = new Set(
        existing.map((e) => `${e.date.toISOString()}|${e.title}`),
      );
      const fresh = keepEvents.filter(
        (e) => !existingKey.has(`${e.date.toISOString()}|${e.title}`),
      );
      if (fresh.length > 0) {
        await tx.academicEvent.createMany({
          data: fresh.map((e) => ({
            title: e.title,
            date: e.date,
            kind: e.kind,
            importedFrom: SOURCE_TAG,
          })),
        });
      }
      insertedEvents = fresh.length;
      skippedEvents = keepEvents.length - fresh.length;
    }

    // ClassDay は同じトランザクション内で置き換え
    const del = await tx.classDay.deleteMany({
      where: { date: { gte: start, lte: end } },
    });
    if (classDays.length > 0) {
      await tx.classDay.createMany({
        data: classDays.map((d) => ({ date: d })),
        skipDuplicates: true,
      });
    }
    return { inserted: classDays.length, deleted: del.count };
  });

  await recordLastFetch(academicYear, insertedEvents, skippedEvents, cd.inserted);

  return NextResponse.json({
    ok: true,
    academicYear,
    inserted: insertedEvents,
    skipped: skippedEvents,
    classDayInserted: cd.inserted,
    classDayDeleted: cd.deleted,
  });
}
