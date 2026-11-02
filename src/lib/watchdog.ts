// アプリ自体が止まったことに気づくための仕組み。
//   - heartbeat: dispatch(毎分)のたびに時刻を残し、前回から間が空いていたら停止として記録する
//   - 外部の見張り: healthchecks.io の Ping URL を登録しておくと、dispatch のたびに ping する。
//     ping が途絶えると healthchecks.io 側からメール等で知らせてくれる
//     (アプリが止まっているとアプリからは通知できないので、外に見張ってもらう)

import { prisma } from "@/lib/db";
import { decryptNotifySecret, encryptNotifySecret } from "@/lib/notifyCrypto";
import { detectOutage, type Outage } from "@/lib/missedReminders";

const HEARTBEAT_KEY = "dispatch_heartbeat";
const LAST_OUTAGE_KEY = "last_outage";
const WATCHDOG_KEY = "watchdog";

// ping は毎分でなくてよい(healthchecks.io の周期は 5 分以上で設定してもらう)
const PING_INTERVAL_MS = 4 * 60_000;
const PING_TIMEOUT_MS = 5_000;

function asDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 今回動いたことを残し、前回から間が空いていたら停止期間を返す。 */
export async function recordHeartbeat(now = new Date()): Promise<Outage | null> {
  const row = await prisma.setting.findUnique({ where: { key: HEARTBEAT_KEY } });
  const last = asDate((row?.value as { at?: unknown } | undefined)?.at);
  await prisma.setting.upsert({
    where: { key: HEARTBEAT_KEY },
    create: { key: HEARTBEAT_KEY, value: { at: now.toISOString() } },
    update: { value: { at: now.toISOString() } },
  });
  const outage = detectOutage(last, now);
  if (outage) {
    const value = { from: outage.from.toISOString(), to: outage.to.toISOString() };
    await prisma.setting.upsert({
      where: { key: LAST_OUTAGE_KEY },
      create: { key: LAST_OUTAGE_KEY, value },
      update: { value },
    });
  }
  return outage;
}

export async function getLastOutage(): Promise<Outage | null> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_OUTAGE_KEY } });
  const v = row?.value as { from?: unknown; to?: unknown } | undefined;
  const from = asDate(v?.from);
  const to = asDate(v?.to);
  return from && to ? { from, to } : null;
}

// healthchecks.io の Ping URL だけを受け付ける(任意の URL へ定期的にリクエストさせない)。
//   https://hc-ping.com/<uuid>  または  https://hc-ping.com/<ping key>/<slug>
const PING_URL = /^https:\/\/hc-ping\.com\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,}\/[a-z0-9-]{1,100})$/;

export function parsePingUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!PING_URL.test(url)) {
    return { ok: false, error: "healthchecks.io の Ping URL(https://hc-ping.com/…)を貼り付けてください" };
  }
  return { ok: true, url };
}

type WatchdogRow = { urlEnc: string; lastPingAt: string | null; lastError: string | null };

async function readWatchdog(): Promise<WatchdogRow | null> {
  const row = await prisma.setting.findUnique({ where: { key: WATCHDOG_KEY } });
  const v = row?.value as Partial<WatchdogRow> | undefined;
  if (!v || typeof v.urlEnc !== "string") return null;
  return { urlEnc: v.urlEnc, lastPingAt: v.lastPingAt ?? null, lastError: v.lastError ?? null };
}

async function writeWatchdog(v: WatchdogRow): Promise<void> {
  await prisma.setting.upsert({
    where: { key: WATCHDOG_KEY },
    create: { key: WATCHDOG_KEY, value: v },
    update: { value: v },
  });
}

export async function saveWatchdogUrl(url: string): Promise<void> {
  await writeWatchdog({ urlEnc: encryptNotifySecret(url), lastPingAt: null, lastError: null });
}

export async function deleteWatchdog(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: WATCHDOG_KEY } });
}

export type WatchdogStatus = {
  configured: boolean;
  summary: string | null;
  lastPingAt: string | null;
  lastError: string | null;
  lastOutage: { from: string; to: string } | null;
};

export async function getWatchdogStatus(): Promise<WatchdogStatus> {
  const [w, outage] = await Promise.all([readWatchdog(), getLastOutage()]);
  let summary: string | null = null;
  if (w) {
    try {
      const url = decryptNotifySecret(w.urlEnc);
      summary = `hc-ping.com/…${url.slice(-4)}`;
    } catch {
      summary = null;
    }
  }
  return {
    configured: !!summary,
    summary,
    lastPingAt: w?.lastPingAt ?? null,
    lastError: w?.lastError ?? null,
    lastOutage: outage ? { from: outage.from.toISOString(), to: outage.to.toISOString() } : null,
  };
}

/**
 * 登録されていれば healthchecks.io に ping する。force でなければ PING_INTERVAL_MS に 1 回まで。
 * 失敗は lastError に残すだけで例外にしない(通知の配信を止めないため)。
 */
export async function pingWatchdog(opts: { force?: boolean; now?: Date } = {}): Promise<{ ok: boolean; error?: string }> {
  const now = opts.now ?? new Date();
  const w = await readWatchdog();
  if (!w) return { ok: false, error: "見張りの Ping URL が未登録です" };
  const last = asDate(w.lastPingAt);
  if (!opts.force && last && now.getTime() - last.getTime() < PING_INTERVAL_MS) return { ok: true };
  let error: string | null = null;
  try {
    const url = decryptNotifySecret(w.urlEnc);
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  await writeWatchdog({ ...w, lastPingAt: error ? w.lastPingAt : now.toISOString(), lastError: error });
  return error ? { ok: false, error } : { ok: true };
}
