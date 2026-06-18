// access_token の取得 (期限切れなら refresh) を、sync / write の両方から呼べる
// ように切り出したヘルパ。両者で同じ retry / 書き戻し動作にしておく。

import { prisma } from "./db";
import { decryptGoogleRefreshToken } from "./googleCrypto";
import { refreshAccessToken } from "./googleOAuth";
import type { GoogleCredential } from "@prisma/client";

const ACCESS_TOKEN_REFRESH_SKEW_SEC = 30;

export async function ensureGoogleAccessToken(
  cred: GoogleCredential,
): Promise<string> {
  const now = Date.now();
  if (
    cred.accessToken &&
    cred.accessTokenExpiresAt &&
    cred.accessTokenExpiresAt.getTime() - now > ACCESS_TOKEN_REFRESH_SKEW_SEC * 1000
  ) {
    return cred.accessToken;
  }
  const refreshToken = decryptGoogleRefreshToken(cred.refreshTokenEnc);
  const tokens = await refreshAccessToken(refreshToken);
  const newExpires = new Date(Date.now() + tokens.expires_in * 1000);
  await prisma.googleCredential.update({
    where: { id: cred.id },
    data: {
      accessToken: tokens.access_token,
      accessTokenExpiresAt: newExpires,
    },
  });
  return tokens.access_token;
}
