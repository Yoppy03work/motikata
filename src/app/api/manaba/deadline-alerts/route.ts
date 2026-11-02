// manaba 締切前の提出チェックを何分前に行うか(アラーム時刻)の取得・保存。
// 保存したら、既存の課題の Reminder もすぐ置き直す。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import {
  DeadlineOffsets,
  getDeadlineOffsets,
  setDeadlineOffsets,
  syncManabaDeadlineReminders,
} from "@/lib/manabaDeadline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({ offsets: DeadlineOffsets });

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  return NextResponse.json({ ok: true, offsets: await getDeadlineOffsets() });
}

export async function PUT(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const body = PutBody.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "1 分前〜7 日前の範囲で、10 個まで設定できます" }, { status: 400 });
  }
  await setDeadlineOffsets(body.data.offsets);
  await syncManabaDeadlineReminders();
  return NextResponse.json({ ok: true, offsets: body.data.offsets });
}
