import argon2 from "argon2";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { prisma } from "./db";
import { sessionOptions, type SessionData } from "./session";

const isProd = process.env.NODE_ENV === "production";

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Cookie が復号できるだけでなく、PIN 変更などで失効していないかを DB と照合する。
 * iron-session は中身を Cookie 自体に持つため、サーバ側で失効させる手段がこれしかない。
 */
export async function isSessionValid(session: SessionData): Promise<boolean> {
  if (!session.authed || session.userId === undefined) return false;
  const user = await prisma.appUser.findUnique({
    where: { id: session.userId },
    select: { sessionVersion: true },
  });
  return !!user && user.sessionVersion === (session.sv ?? 0);
}

export async function ensureAppUser(): Promise<void> {
  const exists = await prisma.appUser.findFirst({ select: { id: true } });
  if (exists) return;

  const initial = process.env.INITIAL_PIN;
  if (!initial) {
    if (isProd) {
      throw new Error(
        "[security] INITIAL_PIN must be set on first run in production. Set INITIAL_PIN env var (4-8 digits) before starting.",
      );
    }
    console.warn("[auth] INITIAL_PIN unset, using '0000' (development only)");
  }
  const pin = initial ?? "0000";
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("[security] INITIAL_PIN must be 4-8 digits");
  }
  const pinHash = await argon2.hash(pin);
  await prisma.appUser.create({ data: { pinHash } });
  console.log("[auth] AppUser を初期化しました — INITIAL_PIN を /settings から変更してください");
}

export async function verifyPin(
  pin: string,
): Promise<{ ok: boolean; userId?: number; sessionVersion?: number }> {
  const user = await prisma.appUser.findFirst({ orderBy: { id: "asc" } });
  if (!user) return { ok: false };
  const ok = await argon2.verify(user.pinHash, pin);
  return ok
    ? { ok: true, userId: user.id, sessionVersion: user.sessionVersion }
    : { ok: false };
}

/** 成功時は新しい sessionVersion を返す(他端末のセッションはこれで失効する)。 */
export async function changePin(
  currentPin: string,
  newPin: string,
): Promise<{ ok: false } | { ok: true; sessionVersion: number }> {
  if (!/^\d{4,8}$/.test(newPin)) return { ok: false };
  const user = await prisma.appUser.findFirst({ orderBy: { id: "asc" } });
  if (!user) return { ok: false };
  const ok = await argon2.verify(user.pinHash, currentPin);
  if (!ok) return { ok: false };
  const pinHash = await argon2.hash(newPin);
  const updated = await prisma.appUser.update({
    where: { id: user.id },
    data: { pinHash, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return { ok: true, sessionVersion: updated.sessionVersion };
}

/**
 * Server Component / Server Action 用: 未認証ならログインへリダイレクト
 */
export async function requireAuthOrRedirect(): Promise<SessionData> {
  const session = await getSession();
  if (!(await isSessionValid(session))) {
    redirect("/login");
  }
  return session;
}
