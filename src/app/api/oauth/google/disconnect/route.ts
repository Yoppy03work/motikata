// POST /api/oauth/google/disconnect
// GoogleCredential を削除 + Google 側でも token を revoke。
// 既に存在しなければ 200 (idempotent)。

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptGoogleRefreshToken } from "@/lib/googleCrypto";
import { revokeGoogleToken } from "@/lib/googleOAuth";

export async function POST() {
  const session = await getSession();
  if (!session.authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cred = await prisma.googleCredential.findUnique({
    where: { singletonKey: "default" },
  });
  if (!cred) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }
  // 先に Google 側の revoke を試みる(失敗しても DB は消す方針)。
  // refresh_token 復号失敗時もスキップして DB だけ消す(壊れた行を残さない)。
  try {
    const refreshToken = decryptGoogleRefreshToken(cred.refreshTokenEnc);
    await revokeGoogleToken(refreshToken);
  } catch {
    // 復号失敗 = 鍵ローテーション等で読めない。DB を消すだけにする。
  }
  await prisma.googleCredential.delete({ where: { id: cred.id } });
  return NextResponse.json({ ok: true });
}
