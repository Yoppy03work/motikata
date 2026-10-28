import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// /api/jobs/* はcron(同一ホスト内のworker)からのみ叩く想定。
// JOBS_TOKEN を Authorization: Bearer で要求する。
// Tailscale 内アクセスでも、内部から叩かれる可能性に備えてトークン認証を必須とする。

function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Authorization: Bearer <JOBS_TOKEN> が一致するか。比較は定数時間で行う。 */
export function hasJobsToken(req: Request): boolean {
  const token = process.env.JOBS_TOKEN;
  if (!token) return false;
  const auth = req.headers.get("authorization") ?? "";
  // 長さの違いで timingSafeEqual が throw しないよう、ハッシュ同士で比べる
  return timingSafeEqual(sha256(auth), sha256(`Bearer ${token}`));
}

export function requireJobsToken(req: Request): NextResponse | null {
  if (!process.env.JOBS_TOKEN) {
    // 設定漏れ防止: 本番はJOBS_TOKEN必須
    return NextResponse.json(
      { error: "JOBS_TOKEN is not configured on server" },
      { status: 500 },
    );
  }
  if (!hasJobsToken(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
