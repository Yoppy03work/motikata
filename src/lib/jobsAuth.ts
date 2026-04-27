import { NextResponse } from "next/server";

// /api/jobs/* はcron(同一ホスト内のworker)からのみ叩く想定。
// JOBS_TOKEN を Authorization: Bearer で要求する。
// Tailscale 内アクセスでも、内部から叩かれる可能性に備えてトークン認証を必須とする。

export function requireJobsToken(req: Request): NextResponse | null {
  const token = process.env.JOBS_TOKEN;
  if (!token) {
    // 設定漏れ防止: 本番はJOBS_TOKEN必須
    return NextResponse.json(
      { error: "JOBS_TOKEN is not configured on server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  if (auth !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
