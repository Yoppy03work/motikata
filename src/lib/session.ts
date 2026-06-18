import type { SessionOptions } from "iron-session";
import { resolveCookieSecure } from "./cookieSecure";

export interface SessionData {
  authed?: boolean;
  userId?: number;
}

const isProd = process.env.NODE_ENV === "production";
const envSecret = process.env.SESSION_SECRET;
const cookieSecure = resolveCookieSecure();

if (isProd && (!envSecret || envSecret.length < 32)) {
  throw new Error(
    "[security] SESSION_SECRET must be set to a 32+ char random string in production",
  );
}

// 開発時のみフォールバックを許容(本番は上で起動失敗)
const password =
  envSecret && envSecret.length >= 32
    ? envSecret
    : "dev-only-secret-change-me-please-32chars-min-length-required-x";

export const sessionOptions: SessionOptions = {
  cookieName: "mochikata_session",
  password,
  cookieOptions: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7日(アイドル)— 重要操作は別途PIN再認証
  },
};
