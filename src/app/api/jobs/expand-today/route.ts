// 今日(と明日)の授業を TaskInstance に展開する内部ジョブ。
// JOBS_TOKEN 認証。worker cron が毎朝 5:00 JST に叩く想定。
//
// デフォルトでは「今日 + 明日」の 2 日分を展開する。
// 理由: Today 画面の「明日の準備」セクション(src/app/(app)/today/page.tsx)が
// 翌日の TaskInstance を読むため、05:00 cron で今日分だけ作っていると
// 前夜は何も表示されず、用意のための持ち物リストも夜中まで現れない。

import { NextResponse } from "next/server";
import { requireJobsToken } from "@/lib/jobsAuth";
import { expandToday } from "@/lib/expandToday";

export const dynamic = "force-dynamic";

function jstYmd(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // UTC で計算しておけば DST の心配がない(JST はそもそも DST が無いが、
  // 同様の流儀で安全側に倒す)。
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    // クエリ ?ymd=YYYY-MM-DD で起点日を指定可(デバッグ用)。
    const baseYmd = url.searchParams.get("ymd") ?? jstYmd(new Date());
    // ?days=N で展開日数(既定 2 = 今日 + 明日)。0 や負値は 1 にクランプ。
    // 上限 14 で暴走を防ぐ。
    const rawDays = Number(url.searchParams.get("days") ?? "2");
    const days = Math.max(1, Math.min(14, Number.isFinite(rawDays) ? rawDays : 2));

    // expandToday は冪等(P2002 を skipped に集計)なので、同じ日を複数回
    // 呼んでも安全。各日の結果を集計して返す。
    const results = [];
    for (let i = 0; i < days; i++) {
      const ymd = addDaysYmd(baseYmd, i);
      const r = await expandToday(ymd);
      results.push(r);
    }
    const totals = results.reduce(
      (acc, r) => ({
        classes: acc.classes + r.classes,
        inserted: acc.inserted + r.inserted,
        skipped: acc.skipped + r.skipped,
        recurringInserted: acc.recurringInserted + r.recurringInserted,
        recurringSkipped: acc.recurringSkipped + r.recurringSkipped,
      }),
      {
        classes: 0,
        inserted: 0,
        skipped: 0,
        recurringInserted: 0,
        recurringSkipped: 0,
      },
    );
    // 最初の日(=ベース日)の isClassDay を主要フラグとして残す(後方互換)。
    return NextResponse.json({
      ok: true,
      ymd: results[0]?.ymd ?? baseYmd,
      isClassDay: results[0]?.isClassDay ?? false,
      days,
      results,
      ...totals,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "expand-today failed" },
      { status: 500 },
    );
  }
}
