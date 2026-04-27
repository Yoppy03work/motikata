import { NextResponse } from "next/server";
import { PinChangeInput } from "@/lib/validation/auth";
import { changePin } from "@/lib/auth";
import { requireAuthApi } from "@/lib/authGuard";

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = PinChangeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }
  const ok = await changePin(parsed.data.currentPin, parsed.data.newPin);
  if (!ok) return NextResponse.json({ error: "現在のPINが違います" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
