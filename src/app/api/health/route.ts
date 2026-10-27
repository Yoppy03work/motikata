// GET /api/health
// 監視 / uptime check 用の health endpoint。認証不要 (PUBLIC_PATHS に追加)。
//
// レスポンス例:
//   { ok: true, db: "ok", lastSync: {
//       manaba: "2026-06-20T04:00:01.000Z" | null,
//       citPortal: "2026-06-20T04:00:30.000Z" | null,
//       google: "2026-06-20T04:00:00.000Z" | null,
//     },
//     uptimeSec: 1234
//   }
//
// 設計:
// - DB に SELECT 1 が通れば db="ok"。失敗 → 503 + db="error"。
// - 各 credential テーブル singletonKey 1 行ずつ lastSync 取得 (未連携は null)。
// - lastSync が「期待時間」より古い場合の判定は呼び出し側 (uptime monitor 等) に
//   委ねる方が柔軟なので、本 endpoint では値を返すだけ。
// - 認証情報 (email 等) は返さない。
// - lastSync は「どのサービスといつ連携しているか」が分かるため、ログイン済みか
//   Authorization: Bearer <JOBS_TOKEN> 付きのリクエストにだけ返す (uptime monitor は
//   ヘッダを付けて叩く)。DB エラーの詳細はサーバログにだけ出す。

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isSessionValid } from "@/lib/auth";
import { hasJobsToken } from "@/lib/jobsAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET(req: Request) {
  let dbOk = false;
  try {
    // SELECT 1 相当の軽量チェック。$queryRaw は文字列 escape 不要なリテラル SQL。
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (e) {
    console.error("[health] db check failed:", e instanceof Error ? e.message : e);
  }

  const detailed = dbOk && (hasJobsToken(req) || (await isSessionValid(await getSession())));

  let manabaLast: Date | null = null;
  let citPortalLast: Date | null = null;
  let googleLast: Date | null = null;
  if (detailed) {
    try {
      const [m, c, g] = await Promise.all([
        prisma.manabaCredential.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { lastSyncedAt: true },
        }),
        prisma.citPortalCredential.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { lastSyncedAt: true },
        }),
        prisma.googleCredential.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { lastSyncAt: true },
        }),
      ]);
      manabaLast = m?.lastSyncedAt ?? null;
      citPortalLast = c?.lastSyncedAt ?? null;
      googleLast = g?.lastSyncAt ?? null;
    } catch {
      // sync 状態取得失敗は db ok でも noise なので null fallback
    }
  }

  const body = {
    ok: dbOk,
    db: dbOk ? "ok" : "error",
    ...(detailed
      ? {
          lastSync: {
            manaba: manabaLast?.toISOString() ?? null,
            citPortal: citPortalLast?.toISOString() ?? null,
            google: googleLast?.toISOString() ?? null,
          },
        }
      : {}),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
