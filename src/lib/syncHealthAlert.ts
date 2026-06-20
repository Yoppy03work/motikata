// Phase 14e: 各種同期 (manaba / CIT ポータル / Google) の lastError を集約して
// Slack に通知する。日次 cron (alert-sync-failures) から呼び出される想定。
//
// 設計:
// - 各 credential テーブル (ManabaCredential / CitPortalCredential /
//   GoogleCredential) と GoogleCalendar の lastError が non-null な行を
//   集めて 1 つの Slack メッセージにまとめる
// - Slack 未設定なら no-op
// - エラーが 1 件もなければ通知を送らない (= 静かな成功)
// - スパム抑制は cron 頻度 (daily) で十分とみなす

import { prisma } from "./db";
import { buildHealthAlertMessage, type HealthAlertEntry } from "./syncHealthAlertMessage";
import { isSlackEnabled, sendSlackMessage } from "./slack";

export type AlertResult = {
  ok: boolean;
  sent: boolean;
  failureCount: number;
  error?: string;
};

export async function runSyncFailureAlert(): Promise<AlertResult> {
  if (!isSlackEnabled()) {
    return { ok: true, sent: false, failureCount: 0 };
  }

  // 各 credential / calendar の lastError を集める。
  // どれも singletonKey 1 行 (manaba/CIT/Google) なので findMany でも安価。
  const [manaba, citPortal, googleCred, googleCals] = await Promise.all([
    prisma.manabaCredential.findMany({
      where: { lastError: { not: null } },
      select: { lastError: true, lastSyncedAt: true },
    }),
    prisma.citPortalCredential.findMany({
      where: { lastError: { not: null } },
      select: { lastError: true, lastSyncedAt: true },
    }),
    prisma.googleCredential.findMany({
      where: { lastError: { not: null } },
      select: { email: true, lastError: true, lastSyncAt: true },
    }),
    prisma.googleCalendar.findMany({
      where: { lastError: { not: null }, enabled: true },
      select: { summary: true, lastError: true, lastSyncAt: true },
    }),
  ]);

  const entries: HealthAlertEntry[] = [];
  for (const m of manaba) {
    entries.push({
      source: "manaba",
      detail: m.lastError ?? "",
      lastAt: m.lastSyncedAt,
    });
  }
  for (const c of citPortal) {
    entries.push({
      source: "CIT ポータル",
      detail: c.lastError ?? "",
      lastAt: c.lastSyncedAt,
    });
  }
  for (const g of googleCred) {
    entries.push({
      source: `Google (${g.email})`,
      detail: g.lastError ?? "",
      lastAt: g.lastSyncAt,
    });
  }
  for (const gc of googleCals) {
    entries.push({
      source: `Google calendar: ${gc.summary}`,
      detail: gc.lastError ?? "",
      lastAt: gc.lastSyncAt,
    });
  }

  if (entries.length === 0) {
    return { ok: true, sent: false, failureCount: 0 };
  }

  const msg = buildHealthAlertMessage(entries);
  try {
    await sendSlackMessage(msg);
    return { ok: true, sent: true, failureCount: entries.length };
  } catch (e) {
    return {
      ok: false,
      sent: false,
      failureCount: entries.length,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}
