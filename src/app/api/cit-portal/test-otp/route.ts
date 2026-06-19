// 保存済みTOTPシークレットから現在の6桁コードを生成して返すデバッグ用エンドポイント。
// Authenticatorアプリの表示と一致するか目視確認するためだけに使う。
//
// セキュリティ:
//   - セッション認証必須
//   - シークレット自体は返さない(コードと残り時間のみ)
//   - レスポンスは Cache-Control: no-store

import { NextResponse } from "next/server";
import { TOTP } from "otpauth";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/authGuard";
import { decryptCitPortalTotpSecret } from "@/lib/citPortalCrypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE32_RE = /^[A-Z2-7]+=*$/;

export async function POST() {
  const guard = await requireAuthApi();
  if (guard) return guard;
  const cred = await prisma.citPortalCredential.findFirst();
  if (!cred) {
    return NextResponse.json(
      { error: "認証情報が登録されていません" },
      { status: 400 },
    );
  }
  let secret: string;
  try {
    secret = decryptCitPortalTotpSecret(cred.totpSecretEnc);
  } catch {
    return NextResponse.json(
      { error: "TOTPシークレットの復号に失敗" },
      { status: 500 },
    );
  }
  const validBase32 = BASE32_RE.test(secret);
  let code = "";
  let codePrev = "";
  let codeNext = "";
  let genError: string | null = null;
  try {
    const totp = new TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    });
    const nowMs = Date.now();
    code = totp.generate({ timestamp: nowMs });
    codePrev = totp.generate({ timestamp: nowMs - 30_000 });
    codeNext = totp.generate({ timestamp: nowMs + 30_000 });
  } catch (e) {
    genError = e instanceof Error ? e.message : String(e);
  }
  const now = Math.floor(Date.now() / 1000);
  const remaining = 30 - (now % 30);
  const secretMasked =
    secret.length > 8
      ? `${secret.slice(0, 4)}…${secret.slice(-4)} (${secret.length}文字)`
      : `(短い: ${secret.length}文字)`;
  return new NextResponse(
    JSON.stringify({
      ok: !genError,
      code,
      codePrev,
      codeNext,
      remainingSec: remaining,
      secretMasked,
      validBase32,
      serverTime: new Date().toISOString(),
      genError,
    }),
    {
      status: genError ? 500 : 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
