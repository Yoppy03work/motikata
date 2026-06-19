// Google カレンダー側への書き戻し (Phase 3 + 4)。
//
// 現状サポート:
//   - events.patch: 既存 GOOGLE 由来 TaskInstance の title/notes/dueAt を反映
//   - events.insert: モチカタで作ったタスクを Google にも作成
//   - events.delete: モチカタで削除した GOOGLE 由来タスクを Google でも削除
//
// ループ回避 (Phase 4):
//   モチカタが push した event を直後の sync が pull で拾うと、source=GOOGLE +
//   同じ sourceExternalId で upsert → no-op になる (現状の sync は
//   sourceExternalId マッチで update なので、自分が書いた値で上書きされる
//   だけで実害なし)。完全な etag/updated 比較は別途必要だが、本フェーズでは
//   未実装でも壊れない。

import { prisma } from "./db";
import { ensureGoogleAccessToken } from "./googleAccessToken";

const EVENTS_API_BASE = "https://www.googleapis.com/calendar/v3/calendars";

// Phase 7: Google API が返す RFC3339 timestamp を安全に Date 化する。
// 仕様外の文字列 (空文字, "now" など) や極端値で Invalid Date になると
// Prisma 経由で RangeError に化けるため、必ず null fallback する。
export function parseGoogleTimestamp(
  s: string | null | undefined,
): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

export type GoogleEventPatch = {
  title?: string;
  notes?: string | null; // null = description クリア
  dueAt?: Date;
};

export type GoogleWriteResult =
  | { ok: true }
  | { ok: false; error: string; conflict?: boolean };

// TaskInstance の id から、Google 側にも patch を反映する。
// 引数の TaskInstance は既に local 更新済みの値であること(呼び出し側で先に local
// 更新 → 成功したら本関数で Google patch 呼ぶ運用)。
// Google 側で失敗しても local は戻さない (ok:false を返すだけ)。UI 側で
// "ローカルは保存したが Google 反映に失敗" メッセージを出して再 sync で
// リカバリさせる方針。
export async function pushTaskInstanceToGoogle(
  taskInstanceId: number,
  patch: GoogleEventPatch,
): Promise<GoogleWriteResult> {
  const ti = await prisma.taskInstance.findUnique({
    where: { id: taskInstanceId },
    select: {
      id: true,
      source: true,
      sourceExternalId: true,
      googleEtag: true,
      googleCalendar: { select: { externalId: true, credential: true } },
    },
  });
  if (!ti) return { ok: false, error: "not found" };
  if (ti.source !== "GOOGLE" || !ti.sourceExternalId || !ti.googleCalendar) {
    return { ok: false, error: "not a google-sourced task" };
  }
  const cred = ti.googleCalendar.credential;
  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(cred);
  } catch (e) {
    return { ok: false, error: `access_token: ${(e as Error).message}` };
  }

  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.notes !== undefined) body.description = patch.notes ?? "";
  if (patch.dueAt !== undefined) {
    // ISO 8601 (with TZ) で送る。Google 側で all-day かどうかは元イベントの
    // 既存値 (start.date vs start.dateTime) で判断されるので、明示的に
    // dateTime で送ると一律 「時間あり」イベントになる。
    // モチカタは TaskInstance.dueAt を 1 つの DateTime で持つ仕様なので、
    // ここでは dateTime 統一で送る (元が all-day だった event も時間付きに昇格)。
    const iso = patch.dueAt.toISOString();
    body.start = { dateTime: iso, timeZone: "Asia/Tokyo" };
    // end が未指定だと Google が 422 を返す。dueAt + 1h を end とする
    // (event の duration を保てない代わりに、一律 1 時間枠で扱う)。
    const end = new Date(patch.dueAt.getTime() + 60 * 60 * 1000);
    body.end = { dateTime: end.toISOString(), timeZone: "Asia/Tokyo" };
  }
  if (Object.keys(body).length === 0) return { ok: true }; // 何も書き換えない

  const url = `${EVENTS_API_BASE}/${encodeURIComponent(ti.googleCalendar.externalId)}/events/${encodeURIComponent(ti.sourceExternalId)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  // Phase 6: 楽観ロック。最後に取得した etag を If-Match で送り、
  // Google 側で別更新が入っていれば 412 (Precondition Failed) で弾かれる。
  // etag を保持していないケース (Phase 5 以前に取り込んだ event) は
  // graceful degradation で If-Match を付けずに送る。
  if (ti.googleEtag) {
    headers["If-Match"] = ti.googleEtag;
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 412) {
    return {
      ok: false,
      conflict: true,
      error:
        "Google カレンダー側で既に別の更新が入っています。同期して最新を取り込んでから再度編集してください",
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `events.patch ${res.status} ${detail.slice(0, 200)}` };
  }
  // 成功時: 応答に最新 etag / updated が含まれるので TaskInstance に焼き込む。
  // 次回の events.list 応答と一致すれば loop avoidance で skip される。
  // Phase 7: 並行 DELETE で行が消えていても 500 にしないため updateMany を使う
  // (where 不一致は count=0 で no-op、例外は出ない)。
  const respJson = (await res.json().catch(() => null)) as {
    etag?: string;
    updated?: string;
  } | null;
  if (respJson && (respJson.etag || respJson.updated)) {
    const updatedAt = parseGoogleTimestamp(respJson.updated);
    await prisma.taskInstance.updateMany({
      where: { id: ti.id },
      data: {
        ...(respJson.etag ? { googleEtag: respJson.etag } : {}),
        ...(updatedAt ? { googleUpdatedAt: updatedAt } : {}),
      },
    });
  }
  return { ok: true };
}

// 指定 GoogleCalendar に新規イベントを作成し、Google が返した event id を返す。
// 失敗時は ok:false で error。
// 呼び出し側はこの id を TaskInstance.sourceExternalId に保存し、
// source=GOOGLE / googleCalendarId に紐付けて、以降は普通の GOOGLE 由来
// タスクと同じ扱いにする (次回 pull で deduplicate される)。
export type GoogleEventInsert = {
  title: string;
  notes?: string | null;
  dueAt: Date;
};

export async function createGoogleEvent(
  googleCalendarId: number,
  payload: GoogleEventInsert,
): Promise<
  | { ok: true; eventId: string; etag: string | null; updatedAt: Date | null }
  | { ok: false; error: string }
> {
  const cal = await prisma.googleCalendar.findUnique({
    where: { id: googleCalendarId },
    select: {
      externalId: true,
      credential: true,
      enabled: true,
    },
  });
  if (!cal) return { ok: false, error: "calendar not found" };
  if (!cal.enabled) return { ok: false, error: "calendar disabled" };

  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(cal.credential);
  } catch (e) {
    return { ok: false, error: `access_token: ${(e as Error).message}` };
  }

  const iso = payload.dueAt.toISOString();
  const end = new Date(payload.dueAt.getTime() + 60 * 60 * 1000);
  const body = {
    summary: payload.title,
    description: payload.notes ?? "",
    start: { dateTime: iso, timeZone: "Asia/Tokyo" },
    end: { dateTime: end.toISOString(), timeZone: "Asia/Tokyo" },
  };

  const url = `${EVENTS_API_BASE}/${encodeURIComponent(cal.externalId)}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      error: `events.insert ${res.status} ${detail.slice(0, 200)}`,
    };
  }
  // Phase 6: 応答の etag / updated を持ち帰り、呼び出し側 (POST /api/tasks) で
  // TaskInstance に焼き込む。直後の sync で loop avoidance が効く。
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    etag?: string;
    updated?: string;
  };
  if (!data.id) return { ok: false, error: "events.insert: response missing id" };
  return {
    ok: true,
    eventId: data.id,
    etag: data.etag ?? null,
    updatedAt: parseGoogleTimestamp(data.updated),
  };
}

// Phase 7/8: POST /api/tasks の transaction が createGoogleEvent 成功後に失敗
// した際の Google 側 orphan event を消すためのヘルパ。
//
// 動作:
//   1. tombstone を SHORT TTL (1 時間) で先に upsert
//      → Google API 失敗時でも 1 時間は sync が orphan を取り込まない
//      → 期限内に retry / cleanup されるかユーザーが気付ける
//   2. Google API を呼ぶ。成功なら LONG TTL に延長、失敗ならそのまま SHORT
//
// Phase 7 では tombstone を書かなかったため、rollback DELETE が失敗すると
// 次の 5 分 sync で『失敗したはずのタスクが復活』する regression があった。
// Best-effort のままだが、最低 SHORT TTL の防御線を張る。
export async function rollbackOrphanGoogleEvent(
  googleCalendarId: number,
  externalEventId: string,
): Promise<void> {
  // 防御線: API 結果を待たずに tombstone を SHORT TTL で書く。
  await writeTombstone(
    googleCalendarId,
    externalEventId,
    GOOGLE_TOMBSTONE_TTL_SHORT_MS,
  );

  const cal = await prisma.googleCalendar.findUnique({
    where: { id: googleCalendarId },
    select: { externalId: true, credential: true },
  });
  if (!cal) return;
  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(cal.credential);
  } catch {
    return; // 取得失敗 → SHORT TTL の tombstone は残る
  }
  const url = `${EVENTS_API_BASE}/${encodeURIComponent(cal.externalId)}/events/${encodeURIComponent(externalEventId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return; // network 失敗 → SHORT TTL の tombstone は残る
  }
  if (res.status === 404 || res.status === 410 || res.ok) {
    // Google 側で確実に消えた (or 既に消えていた) → LONG TTL に延長
    await writeTombstone(
      googleCalendarId,
      externalEventId,
      GOOGLE_TOMBSTONE_TTL_LONG_MS,
    );
  }
}

// tombstone TTL のバリエーション。Google API の結果次第で寿命を変える:
//   - 成功 (200/204) または既に消えていた (404/410):
//     LONG。期待値通り消えているので、復活させない期間として十分長く取る。
//   - 5xx / network error / 一時的な失敗:
//     SHORT。次の cron で再試行する余地を残す。早めに期限切れ → 再 sync で
//     events.list が同 event を返すなら再取り込みされる (ユーザーが再削除可能)。
//   - 401 (refresh トークン失効) / "not a google-sourced task" 等のロジックエラー:
//     0 (= tombstone を書かない)。30 日間サイレントになるのを避ける。
//     ユーザーが再連携した時、event は素直に再取り込みされる。
export const GOOGLE_TOMBSTONE_TTL_LONG_MS = 30 * 24 * 60 * 60 * 1000; // 30 日
export const GOOGLE_TOMBSTONE_TTL_SHORT_MS = 60 * 60 * 1000; // 1 時間

// 後方互換 (古い import path): デフォルトは LONG。
export const GOOGLE_TOMBSTONE_TTL_MS = GOOGLE_TOMBSTONE_TTL_LONG_MS;

// 指定 TaskInstance (GOOGLE 由来) の Google event を削除する。
//
// Phase 7: tombstone を書くタイミングを「Google API の結果が出た後」に変更。
// 401 のような『credential 自体が壊れている』ケースで 30 日間ローカル削除を
// 維持してしまう問題への対処。
//
// 動作:
//   1. Google API を呼ぶ
//   2. 結果に応じた TTL で tombstone を upsert (401 等は 0 = 書かない)
//   3. 結果を呼び出し側 (DELETE /api/tasks/[id]) に返す
//
// 呼び出し側は失敗時もローカル行は削除する方針 (Phase 4 から不変)。
export async function deleteGoogleEventForTaskInstance(
  taskInstanceId: number,
): Promise<GoogleWriteResult> {
  const ti = await prisma.taskInstance.findUnique({
    where: { id: taskInstanceId },
    select: {
      source: true,
      sourceExternalId: true,
      googleCalendarId: true,
      googleCalendar: { select: { externalId: true, credential: true } },
    },
  });
  if (!ti) return { ok: false, error: "not found" };
  if (ti.source !== "GOOGLE" || !ti.sourceExternalId || !ti.googleCalendar || !ti.googleCalendarId) {
    // Pre-Phase-2 行 (googleCalendarId NULL) もここに来る。tombstone は書けない
    // が、次回 sync は events.list で同 id を引いて新規に取り込むので、ユーザー
    // から見ると消したはずの行が復活する。これは Phase 1 互換性の限界として
    // 受容する (Phase 2 以降の行は問題なく動く)。
    return { ok: false, error: "not a google-sourced task" };
  }

  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(ti.googleCalendar.credential);
  } catch (e) {
    // Token 取得失敗 = credential 自体が壊れている。tombstone は書かない
    // (= 再連携後に Google からの再取り込みを止めない)。
    return { ok: false, error: `access_token: ${(e as Error).message}` };
  }
  const url = `${EVENTS_API_BASE}/${encodeURIComponent(ti.googleCalendar.externalId)}/events/${encodeURIComponent(ti.sourceExternalId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    // ネットワーク到達失敗。SHORT TTL で抑えて次の cron に賭ける。
    await writeTombstone(ti.googleCalendarId, ti.sourceExternalId, GOOGLE_TOMBSTONE_TTL_SHORT_MS);
    return { ok: false, error: `events.delete network: ${(e as Error).message}` };
  }
  if (res.status === 404 || res.status === 410) {
    // 既に Google 側で消えていた = 成功扱い。LONG で抑える (再取り込み防止)。
    await writeTombstone(ti.googleCalendarId, ti.sourceExternalId, GOOGLE_TOMBSTONE_TTL_LONG_MS);
    return { ok: true };
  }
  if (res.status === 401 || res.status === 403) {
    // 403 は『rateLimitExceeded / userRateLimitExceeded』のような一時的な
    // ものと、『forbidden』のような真の認可失敗が混ざる。
    // Phase 8: response body の reason / domain を見て分岐。
    //   - 401 / true forbidden: tombstone 書かない (= 再連携で取り込み直し)
    //   - 403 で rateLimitExceeded 系: SHORT TTL で抑え次の cron で retry
    const detail = await res.text().catch(() => "");
    const isRateLimited =
      res.status === 403 &&
      /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(detail);
    if (isRateLimited) {
      await writeTombstone(
        ti.googleCalendarId,
        ti.sourceExternalId,
        GOOGLE_TOMBSTONE_TTL_SHORT_MS,
      );
    }
    return { ok: false, error: `events.delete ${res.status} ${detail.slice(0, 200)}` };
  }
  if (!res.ok) {
    // 5xx / rate limit / その他失敗。SHORT TTL で次回 cron に賭ける。
    await writeTombstone(ti.googleCalendarId, ti.sourceExternalId, GOOGLE_TOMBSTONE_TTL_SHORT_MS);
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `events.delete ${res.status} ${detail.slice(0, 200)}` };
  }
  // 通常成功。LONG TTL で抑える。
  await writeTombstone(ti.googleCalendarId, ti.sourceExternalId, GOOGLE_TOMBSTONE_TTL_LONG_MS);
  return { ok: true };
}

async function writeTombstone(
  googleCalendarId: number,
  externalEventId: string,
  ttlMs: number,
): Promise<void> {
  const now = new Date();
  await prisma.googleTombstone.upsert({
    where: {
      googleCalendarId_externalEventId: { googleCalendarId, externalEventId },
    },
    create: {
      googleCalendarId,
      externalEventId,
      deletedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    },
    update: {
      deletedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    },
  });
}
