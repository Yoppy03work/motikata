// manaba 認証情報の保存 / 削除 / 状態取得。
// パスワードは AES-256-GCM で暗号化して保存。レスポンスでは決して返さない。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { encryptManabaPassword } from "@/lib/manabaCrypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SaveBody = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200),
});

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const row = await prisma.manabaCredential.findFirst({
    select: {
      id: true,
      username: true,
      lastSyncedAt: true,
      lastError: true,
      updatedAt: true,
    },
    orderBy: { id: "desc" },
  });
  return NextResponse.json({ ok: true, credential: row });
}

export async function POST(req: Request) {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const parsed = SaveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { username, password } = parsed.data;
  const passwordEnc = encryptManabaPassword(password);

  // 単一行制約を持つ singletonKey で atomic upsert。
  // 並行リクエスト(ダブルクリック / 別タブ)で複数行が挿入されるのを防ぐ。
  await prisma.manabaCredential.upsert({
    where: { singletonKey: "default" },
    create: { singletonKey: "default", username, passwordEnc },
    update: { username, passwordEnc, lastError: null },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  await prisma.manabaCredential.deleteMany();
  return NextResponse.json({ ok: true });
}
