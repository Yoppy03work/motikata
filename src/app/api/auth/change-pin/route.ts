import { NextResponse } from "next/server";
import { PinChangeInput } from "@/lib/validation/auth";
import { changePin, getSession } from "@/lib/auth";
import { requireAuthApi } from "@/lib/authGuard";

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = PinChangeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const result = await changePin(parsed.data.currentPin, parsed.data.newPin);
  if (!result.ok) return NextResponse.json({ error: "現在のPINが違います" }, { status: 401 });
  // 他端末のセッションは sessionVersion の更新で失効する。この端末だけ新しい値で保存し直す。
  const session = await getSession();
  session.sv = result.sessionVersion;
  await session.save();
  return NextResponse.json({ ok: true });
}
