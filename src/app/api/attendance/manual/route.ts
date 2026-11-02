// manual 出席: ローカル DB に「出席済み」を記録するだけ (外部送信なし)。
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { isValidYmd } from "@/lib/ymd";
import { recordManual } from "@/lib/attendance/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  classScheduleId: z.number().int().positive(),
  classDateYmd: z.string().refine(isValidYmd, "invalid date"),
});

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const result = await recordManual({
    classScheduleId: parsed.data.classScheduleId,
    classDateYmd: parsed.data.classDateYmd,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason, message: result.message },
      { status: 422 },
    );
  }
  return NextResponse.json(result);
}
