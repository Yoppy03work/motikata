// 外部通知先(SLACK / DISCORD / LINE)の登録・ON/OFF・削除。
//   PUT    { config?: {...}, enabled?: boolean }  config があれば登録(上書き)
//   DELETE                                        登録を消す
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthApi } from "@/lib/authGuard";
import { deleteChannel, isExternalKind, saveChannel, setChannelEnabled } from "@/lib/notify";
import { parseNotifyConfig } from "@/lib/notifyConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  config: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { kind } = await params;
  if (!isExternalKind(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  const body = PutBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  if (body.data.config) {
    const parsed = parseNotifyConfig(kind, body.data.config);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    await saveChannel(kind, parsed.config, body.data.enabled ?? true);
    return NextResponse.json({ ok: true });
  }
  if (body.data.enabled !== undefined) {
    const found = await setChannelEnabled(kind, body.data.enabled);
    if (!found) return NextResponse.json({ error: "先に送り先を登録してください" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "nothing to update" }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const { kind } = await params;
  if (!isExternalKind(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  await deleteChannel(kind);
  return NextResponse.json({ ok: true });
}
