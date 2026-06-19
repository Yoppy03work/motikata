// Google カレンダー (有効な全カレンダー) の events を取得し、TaskInstance に
// upsert する。Phase 2 で多カレンダー対応 + 色追従。
//
// フロー:
//   1. credential を取得 + access_token を確保 (期限切れなら refresh)
//   2. calendarList を Google から取得 → GoogleCalendar に upsert
//      (既存行は summary/colorId/colorHex/isPrimary を更新、新規行は enabled=true で挿入)
//      ※ enabled は一度ユーザーが触ったら勝手に上書きしない
//   3. 有効な GoogleCalendar 毎に events.list を回す:
//      - syncToken があれば incremental, 無ければ full sync (timeMin=now-30d)
//      - 410 → syncToken をクリアして full sync で 1 回 retry
//      - cancelled イベントは TaskInstance を SKIPPED 化
//      - 通常イベントは upsert (sourceExternalId キー)
//      - TaskInstance.googleCalendarId と color (calendar の color、event 個別
//        指定があればそちらが優先) を毎回更新
//
// 認証情報の access_token と Google 側のレート上限を共有するため、全カレンダー
// を 1 回の関数呼び出しでシリアル処理する (並列化は今回は採らない)。

import { prisma } from "./db";
import { ensureGoogleAccessToken } from "./googleAccessToken";
import { parseGoogleTimestamp } from "./googleCalendarWrite";
import {
  listCalendarList,
  type GoogleCalendarListEntry,
} from "./googleOAuth";
import {
  resolveGoogleCalendarColor,
  resolveGoogleEventColor,
} from "./googleColors";
import type { GoogleCalendar } from "@prisma/client";

const EVENTS_API_BASE = "https://www.googleapis.com/calendar/v3/calendars";
const FULL_SYNC_LOOKBACK_DAYS = 30;

export type GoogleSyncResult = {
  ok: boolean;
  // 同期できたカレンダー数 (失敗したものは含まない)
  calendars: number;
  added: number;
  updated: number;
  // malformed / dueAt 欠落 / pagination で cancelled→confirmed が並んだ稀ケース
  // の合計。Phase 7 で tombstone 由来は分離。
  skipped: number;
  // tombstone でブロックされた件数 (= 期待動作)。観測しても運用判断に
  // 結びつかないため、skipped と分けて出す。
  skippedTombstone: number;
  cancelled: number;
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
  etag?: string;
  colorId?: string; // event 固有の色 (calendar 色より優先)
};

type EventsListResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

// Google calendarList を取得して GoogleCalendar に upsert。
// enabled フラグはユーザー操作で変えるため、新規行のみ true で初期化し、
// 既存行は触らない (summary/color/isPrimary だけ更新する)。
async function syncCalendarList(
  credId: number,
  accessToken: string,
): Promise<GoogleCalendar[]> {
  const remote: GoogleCalendarListEntry[] = await listCalendarList(accessToken);
  for (const c of remote) {
    const colorHex = resolveGoogleCalendarColor(c.colorId) ?? c.backgroundColor ?? null;
    await prisma.googleCalendar.upsert({
      where: {
        credentialId_externalId: {
          credentialId: credId,
          externalId: c.id,
        },
      },
      create: {
        credentialId: credId,
        externalId: c.id,
        summary: c.summary,
        isPrimary: !!c.primary,
        colorId: c.colorId ?? null,
        colorHex,
        enabled: true,
      },
      update: {
        summary: c.summary,
        isPrimary: !!c.primary,
        colorId: c.colorId ?? null,
        colorHex,
      },
    });
  }
  // Google 側で削除された (今 remote に来てない) カレンダーは disabled に倒す。
  // taskInstance も cascade で消えないよう、enabled だけ false にする。
  const remoteIds = new Set(remote.map((c) => c.id));
  const local = await prisma.googleCalendar.findMany({
    where: { credentialId: credId },
  });
  for (const l of local) {
    if (!remoteIds.has(l.externalId) && l.enabled) {
      await prisma.googleCalendar.update({
        where: { id: l.id },
        data: { enabled: false },
      });
    }
  }
  return prisma.googleCalendar.findMany({
    where: { credentialId: credId, enabled: true },
    orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
  });
}

async function fetchEventPage(
  calendarExternalId: string,
  accessToken: string,
  params: URLSearchParams,
): Promise<EventsListResponse> {
  const url = `${EVENTS_API_BASE}/${encodeURIComponent(calendarExternalId)}/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 410) {
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
  const dt = ev.start?.dateTime;
  if (dt) {
    const d = new Date(dt);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = ev.start?.date;
  if (d) {
    const parsed = new Date(`${d}T00:00:00+09:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

// Phase 13: end.date / end.dateTime をパースする。
// Google all-day では end.date は exclusive (翌日)。timed では end.dateTime は inclusive。
// ローカルでは TaskInstance.endAt にそのまま保存する (= multi-day all-day も保持)。
function parseEventEnd(ev: GoogleEvent): Date | null {
  const dt = ev.end?.dateTime;
  if (dt) {
    const d = new Date(dt);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = ev.end?.date;
  if (d) {
    const parsed = new Date(`${d}T00:00:00+09:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

// Phase 13: all-day event 判定。Google API では start.date / start.dateTime
// が存在する側で判定できるので heuristic 不要。
function isAllDayEvent(ev: GoogleEvent): boolean {
  return !!ev.start?.date && !ev.start?.dateTime;
}

function buildNotes(ev: GoogleEvent): string | null {
  const parts: string[] = [];
  if (ev.location) parts.push(`場所: ${ev.location}`);
  if (ev.description) parts.push(ev.description);
  const joined = parts.join("\n\n").trim();
  return joined.length > 0 ? joined : null;
}

async function syncOneCalendar(
  cal: GoogleCalendar,
  accessToken: string,
): Promise<{
  added: number;
  updated: number;
  cancelled: number;
  skipped: number;
  skippedTombstone: number;
}> {
  let added = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;
  let skippedTombstone = 0;
  let nextPageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let usingFullSync = false;

  const buildParams = (pageToken?: string): URLSearchParams => {
    const p = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
    });
    if (pageToken) p.set("pageToken", pageToken);
    if (cal.syncToken && !usingFullSync) {
      p.set("syncToken", cal.syncToken);
    } else {
      const timeMin = new Date(
        Date.now() - FULL_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      p.set("timeMin", timeMin);
      p.set("orderBy", "startTime");
    }
    return p;
  };

  // Phase 6: ローカルで削除したイベントの tombstone をまとめて読み込んでおく
  // (有効期限内のもののみ)。events.list で同じ id が戻ってきたら再生成しない。
  // Phase 7: 長い pagination 中に他リクエストで新 tombstone が書かれた場合
  // 検出を逃すため、新規作成 (create) のときだけは個別 re-check する。
  const now = new Date();
  const tombstones = await prisma.googleTombstone.findMany({
    where: { googleCalendarId: cal.id, expiresAt: { gt: now } },
    select: { externalEventId: true },
  });
  const tombstoneSet = new Set(tombstones.map((t) => t.externalEventId));

  // Phase 7: 同じ events.list response のページ内で cancelled → confirmed の
  // 順で 2 件出てくる稀ケースに備え、1 度 cancelled で削除した tombstone を
  // 同 sync 内では復元しない (= 既に cancel された id が後で confirmed に
  // 化けても再生成しない)。次回 sync で再評価される。
  const cancelledThisRun = new Set<string>();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      do {
        const params = buildParams(nextPageToken);
        const page = await fetchEventPage(cal.externalId, accessToken, params);
        for (const ev of page.items ?? []) {
          if (ev.status === "cancelled") {
            const existing = await prisma.taskInstance.findFirst({
              where: { source: "GOOGLE", sourceExternalId: ev.id },
              select: { id: true, status: true },
            });
            if (existing && existing.status !== "SKIPPED") {
              // Phase 9: 並行 DELETE で行が消えていても 500 にしないため
              // updateMany を使う (where 不一致は count=0 で no-op)。
              const r = await prisma.taskInstance.updateMany({
                where: { id: existing.id },
                data: { status: "SKIPPED" },
              });
              if (r.count > 0) cancelled++;
            }
            // Google 側で cancelled になったので tombstone は不要 (上書き
            // 防止の意味がない)。あれば消す。
            // Phase 7: 同じ run 内で再度 confirmed が出ても再生成しないよう、
            // cancelled として観測した id は記録しておく。
            if (tombstoneSet.has(ev.id)) {
              await prisma.googleTombstone.deleteMany({
                where: { googleCalendarId: cal.id, externalEventId: ev.id },
              });
              tombstoneSet.delete(ev.id);
            }
            cancelledThisRun.add(ev.id);
            continue;
          }
          // Phase 7: 同じ run 内で既に cancelled として観測した id は無視。
          // Google ページネーション境界で cancelled → confirmed が並ぶ稀ケース
          // で「消したはずなのに復活」を防ぐ。
          if (cancelledThisRun.has(ev.id)) {
            skipped++;
            continue;
          }
          // Phase 6: tombstone があるイベントは「モチカタで消した」シグナル。
          // Google 側で復活させていない (= まだ Google 側に残ってる)
          // 状態なので、ローカルへの再生成はスキップする。
          // events.delete API が落ちて Google には残った場合のリカバリパス。
          // 期限 (30 日) を過ぎたら tombstone は自動的に掃除されるので
          // 「ずっと再生成されない」状態にはならない。
          if (tombstoneSet.has(ev.id)) {
            skippedTombstone++;
            continue;
          }
          const dueAt = parseEventDate(ev);
          if (!dueAt || !ev.summary) {
            skipped++;
            continue;
          }
          // 表示色: event 個別の colorId > calendar の colorHex の優先で解決。
          const eventColor = resolveGoogleEventColor(ev.colorId);
          const color = eventColor ?? cal.colorHex ?? null;
          const updatedAt = parseGoogleTimestamp(ev.updated);
          // Phase 8: 既存行 update では「Google が source of truth な field」
          // だけ書き戻す。ユーザーがローカルで触れる field (status, required,
          // itemType, priority, completedAt) は上書きしない。
          // Phase 7 で status: "OPEN" を unconditional に入れていたが、
          // DONE/SKIPPED の Google タスクが毎 sync で OPEN に巻き戻る regression
          // を起こしていた。SKIPPED→OPEN (undelete) のみ別 path で復活させる。
          // Phase 13: endAt / isAllDay を Google から保持 (multi-day all-day &
          // event duration 復元用)。
          const endAt = parseEventEnd(ev);
          const isAllDay = isAllDayEvent(ev);
          const updateData = {
            title: ev.summary,
            notes: buildNotes(ev),
            dueAt,
            endAt,
            isAllDay,
            color,
            googleEtag: ev.etag ?? null,
            googleUpdatedAt: updatedAt,
          };
          // 新規 create は status=OPEN + itemType=EVENT + required=false の
          // デフォルトをここで決める。create-only な field をまとめる。
          const createData = {
            ...updateData,
            itemType: "EVENT" as const,
            required: false,
            source: "GOOGLE" as const,
            sourceExternalId: ev.id,
            googleCalendarId: cal.id,
            status: "OPEN" as const,
          };
          const existing = await prisma.taskInstance.findFirst({
            where: { source: "GOOGLE", sourceExternalId: ev.id },
            select: {
              id: true,
              googleEtag: true,
              googleUpdatedAt: true,
              status: true,
            },
          });
          if (existing) {
            // Phase 9: SKIPPED→OPEN の復活判定を厳格化。Phase 8 では
            // existing.status === "SKIPPED" だけで全 guard をバイパスして
            // 上書きしていたため、Google が unchanged な confirmed を再送した
            // (full-sync fallback 等) だけで毎回 flip-flop が起きた。
            // 「Google 側で実際に状態変化があった」を保証する条件として:
            //   etag が変わっている OR ev.updated > existing.googleUpdatedAt
            // のいずれかを必須にする。それでも etag/updatedAt が両方無い
            // legacy 行で発火しないよう、両方とも比較不能なら revive 抑制。
            //
            // Phase 10: existing.googleEtag が NULL (= 比較ベースラインが無い)
            // ケースでは etagChanged は単に「初めて etag を受信した」状態を
            // 意味するため、状態変化の証拠にならない。Phase 6 migration 直後の
            // 全 SKIPPED 行が初回 sync で revive されないように、
            // existing.googleEtag が non-null の場合だけ etag 比較を有効に。
            const etagChanged = !!(
              ev.etag &&
              existing.googleEtag &&
              existing.googleEtag !== ev.etag
            );
            const updatedAdvanced = !!(
              updatedAt &&
              existing.googleUpdatedAt &&
              updatedAt.getTime() > existing.googleUpdatedAt.getTime()
            );
            const reviveFromSkipped =
              existing.status === "SKIPPED" && (etagChanged || updatedAdvanced);

            // Phase 6/7/8/9: loop avoidance。etag 一致 = 「変化無し」。
            // 復活ケース (reviveFromSkipped) は抜けない (= 確実に書き戻す)。
            if (
              ev.etag &&
              existing.googleEtag === ev.etag &&
              !reviveFromSkipped
            ) {
              continue;
            }
            // Google updated が古い or 等値 (= 変化無し echo) を skip。
            if (
              existing.googleUpdatedAt &&
              updatedAt &&
              updatedAt.getTime() <= existing.googleUpdatedAt.getTime() &&
              !reviveFromSkipped
            ) {
              continue;
            }
            // Phase 8: 並行 DELETE で行が消えていても 500 にしないため
            // updateMany を使う (where 不一致は count=0 で no-op)。
            // Phase 9: count 0 のとき updated++ を加算しない (metric 正確化)。
            const r = await prisma.taskInstance.updateMany({
              where: { id: existing.id },
              data: reviveFromSkipped
                ? { ...updateData, status: "OPEN", completedAt: null }
                : updateData,
            });
            if (r.count > 0) updated++;
          } else {
            // Phase 7: pagination 中に書き加えられた tombstone を再度確認
            // (snapshot の snapshot 問題)。
            const fresh = await prisma.googleTombstone.findUnique({
              where: {
                googleCalendarId_externalEventId: {
                  googleCalendarId: cal.id,
                  externalEventId: ev.id,
                },
              },
              select: { expiresAt: true },
            });
            if (fresh && fresh.expiresAt > new Date()) {
              tombstoneSet.add(ev.id);
              skippedTombstone++;
              continue;
            }
            await prisma.taskInstance.create({ data: createData });
            added++;
          }
        }
        nextPageToken = page.nextPageToken;
        if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
      } while (nextPageToken);
      break;
    } catch (e) {
      if ((e as Error & { code?: number }).code === 410 && attempt === 0) {
        usingFullSync = true;
        nextPageToken = undefined;
        nextSyncToken = undefined;
        continue;
      }
      // この calendar はエラーで止める。lastError に書いて呼び出し側に投げる。
      const msg = e instanceof Error ? e.message : "unknown";
      await prisma.googleCalendar.update({
        where: { id: cal.id },
        data: { lastError: msg.slice(0, 500) },
      });
      throw e;
    }
  }

  await prisma.googleCalendar.update({
    where: { id: cal.id },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      syncToken: nextSyncToken ?? cal.syncToken,
    },
  });
  return { added, updated, cancelled, skipped, skippedTombstone };
}

export async function syncGoogleCalendar(): Promise<GoogleSyncResult> {
  const cred = await prisma.googleCredential.findUnique({
    where: { singletonKey: "default" },
  });
  if (!cred) {
    return {
      ok: false,
      calendars: 0,
      added: 0,
      updated: 0,
      skipped: 0,
      skippedTombstone: 0,
      cancelled: 0,
      error: "Google カレンダー未連携",
    };
  }

  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(cred);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await prisma.googleCredential.update({
      where: { id: cred.id },
      data: { lastError: `access_token 取得失敗: ${msg}`.slice(0, 500) },
    });
    return {
      ok: false,
      calendars: 0,
      added: 0,
      updated: 0,
      skipped: 0,
      skippedTombstone: 0,
      cancelled: 0,
      error: msg,
    };
  }

  let enabledCalendars: GoogleCalendar[];
  try {
    enabledCalendars = await syncCalendarList(cred.id, accessToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await prisma.googleCredential.update({
      where: { id: cred.id },
      data: { lastError: `calendarList 失敗: ${msg}`.slice(0, 500) },
    });
    return {
      ok: false,
      calendars: 0,
      added: 0,
      updated: 0,
      skipped: 0,
      skippedTombstone: 0,
      cancelled: 0,
      error: msg,
    };
  }

  let added = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;
  let skippedTombstone = 0;
  let succeeded = 0;
  // どれか 1 つでも events.list が落ちた場合は credential.lastError に書いて
  // 戻り値も ok=false にする。ただし他のカレンダーは可能な範囲で進める。
  let firstError: string | null = null;

  for (const cal of enabledCalendars) {
    try {
      const r = await syncOneCalendar(cal, accessToken);
      added += r.added;
      updated += r.updated;
      cancelled += r.cancelled;
      skipped += r.skipped;
      skippedTombstone += r.skippedTombstone;
      succeeded++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      if (!firstError) firstError = `${cal.summary}: ${msg}`;
    }
  }

  await prisma.googleCredential.update({
    where: { id: cred.id },
    data: {
      lastSyncAt: new Date(),
      lastError: firstError?.slice(0, 500) ?? null,
    },
  });

  return {
    ok: firstError === null,
    calendars: succeeded,
    added,
    updated,
    cancelled,
    skipped,
    skippedTombstone,
    error: firstError ?? undefined,
  };
}
