// 外部の見張り(healthchecks.io)の登録と、最後に止まっていた期間の表示。
//   GET                 状態(Ping URL は末尾だけ)
//   PUT    { url }      Ping URL を登録(上書き)して 1 回 ping する
//   POST                テスト ping
//   DELETE              登録を消す
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import {
  deleteWatchdog,
  getWatchdogStatus,
  parsePingUrl,
  pingWatchdog,
  saveWatchdogUrl,
} from "@/lib/watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  return NextResponse.json(await getWatchdogStatus());
}

const PutBody = z.object({ url: z.string().max(300) });

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const body = PutBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const parsed = parsePingUrl(body.data.url);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await saveWatchdogUrl(parsed.url);
  const ping = await pingWatchdog({ force: true });
  return NextResponse.json({ ok: true, ping });
}

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const ping = await pingWatchdog({ force: true });
  if (!ping.ok) return NextResponse.json({ error: ping.error ?? "ping 失敗" }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  await deleteWatchdog();
  return NextResponse.json({ ok: true });
}
