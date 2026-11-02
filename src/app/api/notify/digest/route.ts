// 締切のまとめ通知の時刻設定。
//   GET              { times: ["21:00", ...] }
//   PUT { times }    時刻を保存
//   POST             今すぐ 1 通送ってみる(確認用)
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { DigestTimes, getDigestTimes, sendDigestNow, setDigestTimes } from "@/lib/dailyDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  return NextResponse.json({ times: await getDigestTimes() });
}

const PutBody = z.object({ times: DigestTimes });

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const body = PutBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "時刻は HH:MM で最大 6 個までです" }, { status: 400 });
  await setDigestTimes(body.data.times);
  return NextResponse.json({ times: body.data.times });
}

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const result = await sendDigestNow();
  if (result.kind === "skipped") return NextResponse.json({ error: result.reason }, { status: 400 });
  if (result.kind === "failed") return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
