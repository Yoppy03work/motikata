// confirm 出席: スキャンした QR を検証し、出席システムに実送信する。
// noQr: true のときは QR なし (設定で許可した授業だけ。教室番号はサーバー側で決める)。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { isValidYmd } from "@/lib/ymd";
import { parseAttendanceQrUrl } from "@/lib/attendance/qr";
import { submitConfirm, submitNoQr } from "@/lib/attendance/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  classScheduleId: z.number().int().positive(),
  classDateYmd: z.string().refine(isValidYmd, "invalid date"),
  // 生の QR 文字列。サーバー側で検証する (untrusted 入力)。
  qr: z.string().min(1).max(2048).optional(),
  noQr: z.literal(true).optional(),
});

function reply(result: Awaited<ReturnType<typeof submitConfirm>>) {
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: 422 },
    );
  }
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (parsed.data.noQr) {
    return reply(
      await submitNoQr({
        classScheduleId: parsed.data.classScheduleId,
        classDateYmd: parsed.data.classDateYmd,
      }),
    );
  }
  if (!parsed.data.qr) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // QR をサーバー側でパース。raw 文字列はレスポンス/ログに出さない。
  const qr = parseAttendanceQrUrl(parsed.data.qr);
  if (!qr.ok) {
    return NextResponse.json({ error: "invalid_qr", reason: qr.reason }, { status: 400 });
  }

  return reply(
    await submitConfirm({
      classScheduleId: parsed.data.classScheduleId,
      classDateYmd: parsed.data.classDateYmd,
      roomId: qr.roomId,
    }),
  );
}
