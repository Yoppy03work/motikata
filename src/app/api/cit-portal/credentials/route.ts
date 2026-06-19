// CITポータル認証情報の保存 / 削除 / 状態取得。
// パスワードと TOTP シークレットは AES-256-GCM で暗号化して保存。
// レスポンスでは決して返さない。

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import {
  encryptCitPortalPassword,
  encryptCitPortalTotpSecret,
  normalizeTotpSecret,
} from "@/lib/citPortalCrypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SaveBody = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200),
  // BASE32 シークレットは通常 16 / 26 / 32 文字。otpauth:// URI 形式も許容。
  totpSecret: z.string().min(8).max(400),
  // Keycloakクレデンシャル選択画面でマッチさせるデバイス名(任意・部分一致)
  totpDeviceName: z.string().max(120).optional().nullable(),
});

export async function GET() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const row = await prisma.citPortalCredential.findFirst({
    select: {
      id: true,
      username: true,
      totpDeviceName: true,
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
  const totpSecret = normalizeTotpSecret(parsed.data.totpSecret);
  if (!/^[A-Z2-7]+=*$/.test(totpSecret)) {
    return NextResponse.json(
      { error: "TOTPシークレットは BASE32 形式 (A-Z, 2-7) で入力してください" },
      { status: 400 },
    );
  }
  const passwordEnc = encryptCitPortalPassword(password);
  const totpSecretEnc = encryptCitPortalTotpSecret(totpSecret);
  const totpDeviceName = parsed.data.totpDeviceName?.trim() || null;

  // 単一行制約を持つ singletonKey で atomic upsert。
  // 並行リクエスト(ダブルクリック / 別タブ)で複数行が挿入されるのを防ぐ。
  await prisma.citPortalCredential.upsert({
    where: { singletonKey: "default" },
    create: {
      singletonKey: "default",
      username,
      passwordEnc,
      totpSecretEnc,
      totpDeviceName,
    },
    update: {
      username,
      passwordEnc,
      totpSecretEnc,
      totpDeviceName,
      lastError: null,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  await prisma.citPortalCredential.deleteMany();
  return NextResponse.json({ ok: true });
}
