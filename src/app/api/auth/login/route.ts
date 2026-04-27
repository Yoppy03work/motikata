import { NextResponse } from "next/server";
import { PinLoginInput } from "@/lib/validation/auth";
import { ensureAppUser, getSession, verifyPin } from "@/lib/auth";
import { checkLockout, clientKey, recordFailure, recordSuccess } from "@/lib/rateLimit";

export async function POST(req: Request) {
  await ensureAppUser();

  const key = clientKey(req);
  const lock = await checkLockout(key);
  if (!lock.allowed) {
    return NextResponse.json(
      {
        error: `試行回数が多すぎます。${Math.ceil((lock.retryAfterSec ?? 0) / 60)}分後にお試しください`,
      },
      { status: 429, headers: { "Retry-After": String(lock.retryAfterSec ?? 60) } },
    );
  }

  const parsed = PinLoginInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "PINが不正です" }, { status: 400 });
  }
  const result = await verifyPin(parsed.data.pin);
  if (!result.ok) {
    const fail = await recordFailure(key);
    if (fail.lockedOut) {
      return NextResponse.json(
        {
          error: `失敗回数が上限に達しました。${Math.ceil((fail.retryAfterSec ?? 0) / 60)}分間ロックされます`,
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: `PINが違います(残り${fail.remaining}回)` },
      { status: 401 },
    );
  }

  await recordSuccess(key);
  const session = await getSession();
  session.authed = true;
  session.userId = result.userId;
  await session.save();
  return NextResponse.json({ ok: true });
}
