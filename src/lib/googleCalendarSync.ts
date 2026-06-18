// Google カレンダー (primary) の events を取得し、TaskInstance に upsert する。
//
// 戦略:
//   - syncToken があれば incremental sync, 無ければ timeMin=now-30d で full sync
//   - 410 Gone (= syncToken 失効) → syncToken=null に戻して次回 full sync
//   - cancelled イベントは TaskInstance を SKIPPED 化 (削除ではなく履歴保持)
//   - 通常イベントは upsert (sourceExternalId をキーにマッチ)
//
// 認証フロー:
//   1. GoogleCredential を取得
//   2. accessToken 期限切れなら refresh_token から再発行 → DB に書き戻し
//   3. events.list を呼ぶ
//
// 関数自体は副作用込みで DB を触る。呼び出し側 (cron / sync-now route) は
// 戻り値 (件数 + lastError) を見て UI に反映する。

import { prisma } from "./db";
import { decryptGoogleRefreshToken } from "./googleCrypto";
import { refreshAccessToken } from "./googleOAuth";
import type { GoogleCredential } from "@prisma/client";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
// 初回 full sync で遡る日数。それより古い予定はモチカタに取り込まない。
const FULL_SYNC_LOOKBACK_DAYS = 30;
// access_token の期限が残り何秒以下なら refresh するか。30s 余裕を取る。
const ACCESS_TOKEN_REFRESH_SKEW_SEC = 30;

export type GoogleSyncResult = {
  ok: boolean;
  added: number;
  updated: number;
  skipped: number; // 取り込まずスキップした件数
  cancelled: number; // 取消イベントから SKIPPED に倒した件数
  error?: string;
};

type GoogleEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  updated?: string;
};

type EventsListResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

async function ensureAccessToken(cred: GoogleCredential): Promise<string> {
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

async function fetchPage(
  accessToken: string,
  params: URLSearchParams,
): Promise<EventsListResponse> {
  const res = await fetch(`${CALENDAR_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 410) {
    // syncToken 失効。呼び出し側で full sync に降格する目印として throw する。
    const err = new Error("sync_token_invalid");
    (err as Error & { code?: number }).code = 410;
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`events.list failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as EventsListResponse;
}

function parseEventDate(ev: GoogleEvent): Date | null {
  // start.dateTime (時間あり) を優先。無ければ start.date (終日) を 00:00 JST 扱い。
  const dt = ev.start?.dateTime;
  if (dt) {
    const d = new Date(dt);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = ev.start?.date;
  if (d) {
    // "YYYY-MM-DD" を JST 0 時として解釈。
    const parsed = new Date(`${d}T00:00:00+09:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function buildNotes(ev: GoogleEvent): string | null {
  const parts: string[] = [];
  if (ev.location) parts.push(`場所: ${ev.location}`);
  if (ev.description) parts.push(ev.description);
  const joined = parts.join("\n\n").trim();
  return joined.length > 0 ? joined : null;
}

export async function syncGoogleCalendar(): Promise<GoogleSyncResult> {
  const cred = await prisma.googleCredential.findUnique({
    where: { singletonKey: "default" },
  });
  if (!cred) {
    return {
      ok: false,
      added: 0,
      updated: 0,
      skipped: 0,
      cancelled: 0,
      error: "Google カレンダー未連携",
    };
  }

  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(cred);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await prisma.googleCredential.update({
      where: { id: cred.id },
      data: { lastError: `access_token 取得失敗: ${msg}`.slice(0, 500) },
    });
    return {
      ok: false,
      added: 0,
      updated: 0,
      skipped: 0,
      cancelled: 0,
      error: msg,
    };
  }

  let added = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;
  let nextPageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let usingFullSync = false;

  // syncToken と timeMin は排他。
  // syncToken があれば incremental。無ければ full sync (timeMin=now-30d)。
  const buildParams = (pageToken?: string): URLSearchParams => {
    const p = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
    });
    if (pageToken) p.set("pageToken", pageToken);
    if (cred.syncToken && !usingFullSync) {
      p.set("syncToken", cred.syncToken);
    } else {
      const timeMin = new Date(
        Date.now() - FULL_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      p.set("timeMin", timeMin);
      p.set("orderBy", "startTime");
    }
    return p;
  };

  // 410 を受けたら syncToken をクリアして 1 度だけ retry。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      do {
        const params = buildParams(nextPageToken);
        const page: EventsListResponse = await fetchPage(accessToken, params);
        for (const ev of page.items ?? []) {
          if (ev.status === "cancelled") {
            // 同期済みなら SKIPPED に倒す。元から無ければ no-op。
            const existing = await prisma.taskInstance.findFirst({
              where: { source: "GOOGLE", sourceExternalId: ev.id },
              select: { id: true, status: true },
            });
            if (existing && existing.status !== "SKIPPED") {
              await prisma.taskInstance.update({
                where: { id: existing.id },
                data: { status: "SKIPPED" },
              });
              cancelled++;
            }
            continue;
          }
          const dueAt = parseEventDate(ev);
          if (!dueAt || !ev.summary) {
            skipped++;
            continue;
          }
          const existing = await prisma.taskInstance.findFirst({
            where: { source: "GOOGLE", sourceExternalId: ev.id },
            select: { id: true },
          });
          const data = {
            title: ev.summary,
            notes: buildNotes(ev),
            dueAt,
            itemType: "EVENT" as const,
            required: false,
            source: "GOOGLE" as const,
            sourceExternalId: ev.id,
          };
          if (existing) {
            await prisma.taskInstance.update({
              where: { id: existing.id },
              data,
            });
            updated++;
          } else {
            await prisma.taskInstance.create({ data });
            added++;
          }
        }
        nextPageToken = page.nextPageToken;
        if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
      } while (nextPageToken);
      break; // 成功して loop 終了
    } catch (e) {
      if ((e as Error & { code?: number }).code === 410 && attempt === 0) {
        // syncToken 失効。null に倒して full sync に降格して retry。
        usingFullSync = true;
        nextPageToken = undefined;
        nextSyncToken = undefined;
        continue;
      }
      const msg = e instanceof Error ? e.message : "unknown";
      await prisma.googleCredential.update({
        where: { id: cred.id },
        data: { lastError: `events.list 失敗: ${msg}`.slice(0, 500) },
      });
      return { ok: false, added, updated, skipped, cancelled, error: msg };
    }
  }

  await prisma.googleCredential.update({
    where: { id: cred.id },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      // nextSyncToken は最終ページに付く。途中で失敗すると undefined のまま残す
      // (次回も同じ範囲を再フェッチする)。
      syncToken: nextSyncToken ?? cred.syncToken,
    },
  });
  return { ok: true, added, updated, skipped, cancelled };
}
