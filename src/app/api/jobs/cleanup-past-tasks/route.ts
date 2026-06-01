// 締切が過ぎた「使い捨て」TaskInstance だけを削除する。
//
// 対象を厳しく絞る理由:
//   - 旧版は itemType=TASK で dueAt<now を全部消していたが、これだと
//     ユーザが手で作った MANUAL タスクや /templates 由来の RECURRING、
//     さらに既に DONE / SKIPPED 済みの完了履歴まで吹き飛ばしていた。
//     週次完了ダッシュボード(/api/stats)が cleanup 後に履歴を失い、
//     overdue カウントも毎日 04:00 で 0 にリセットされて意味を失う。
//
// 残すべきもの:
//   - status != OPEN (= DONE / SKIPPED): 完了/見送り履歴。stats が必要とする。
//   - source = MANUAL: ユーザが自分で入れたタスク。アプリが勝手に消さない。
//   - source = RECURRING: テンプレ展開分。同上。
//   - source = CLASS: expand-today が当日朝に作る授業 EVENT。
//                     そもそも itemType=EVENT のはずなので itemType フィルタで除外。
//
// 消してよいのは「外部ソースから再取得されるはずだったが期限切れの OPEN」だけ:
//   - source = ACADEMIC (= manaba sync): 期限を過ぎた未完了の課題。
//     manabaSync は dueAt>now のものしか取り込まないので、再 sync しても
//     復活しない。OPEN のまま腐っているとリストに残り続けるので GC する。
//
// 関連する Reminder / TaskInstanceCheck / TaskInstanceTag は
// schema の onDelete: Cascade で自動削除される。
// JOBS_TOKEN 必須(worker から 04:00 / 13:00 / 19:00 JST に叩かれる)。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireJobsToken } from "@/lib/jobsAuth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireJobsToken(req);
  if (denied) return denied;

  const now = new Date();
  const result = await prisma.taskInstance.deleteMany({
    where: {
      itemType: "TASK",
      status: "OPEN",
      source: "ACADEMIC",
      dueAt: { lt: now },
    },
  });
  return NextResponse.json({
    ok: true,
    deleted: result.count,
    asOf: now.toISOString(),
  });
}
