import type { SessionOptions } from "iron-session";
import { resolveCookieSecure } from "./cookieSecure";

export interface SessionData {
  authed?: boolean;
  userId?: number;
  // AppUser.sessionVersion のスナップショット。isSessionValid で照合する。
  sv?: number;
}

const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const isProd = process.env.NODE_ENV === "production";
const envSecret = process.env.SESSION_SECRET;
const cookieSecure = resolveCookieSecure();

// next build もこのモジュールを評価するが、build 時には秘密を渡さない
// (.env は .dockerignore で build context から除外している) ので、起動時のみ検査する。
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

if (isProd && !isBuild && (!envSecret || envSecret.length < 32)) {
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
  // 暗号化された中身の有効期限。未指定だと iron-session 既定の 14 日になり、
  // Cookie の maxAge (7 日) より長く有効なまま残る。
  ttl: SESSION_TTL_SEC,
  cookieOptions: {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC, // ログインから 7 日(延長しない)— 重要操作は別途PIN再認証
  },
};
