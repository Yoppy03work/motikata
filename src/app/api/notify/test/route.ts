// 通知先へのテスト送信。OFF にしている通知先にも送れる(登録内容の確認用)。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { NotifyNotConfigured, sendVia } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(["PUSH", "SLACK", "DISCORD", "LINE"]) });

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    await sendVia(
      body.data.kind,
      { title: "モチカタ: テスト通知", body: "この通知が届いていれば設定は正しいです", url: "/settings" },
      { ignoreDisabled: true },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof NotifyNotConfigured ? 400 : 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : "送信失敗" }, { status });
  }
}
