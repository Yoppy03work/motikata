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
  const respJson = (await res.json().catch(() => null)) as {
    etag?: string;
    updated?: string;
  } | null;
  if (respJson && (respJson.etag || respJson.updated)) {
    await prisma.taskInstance.update({
      where: { id: ti.id },
      data: {
        googleEtag: respJson.etag ?? undefined,
        googleUpdatedAt: respJson.updated ? new Date(respJson.updated) : undefined,
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
    updatedAt: data.updated ? new Date(data.updated) : null,
  };
}

// Phase 6: tombstone のデフォルト有効期限 (30 日)。
// それ以上経過していれば Google 側でも本当に消えているはずで、
// tombstone は不要 (掃除しても再生成リスクが無視できる)。
export const GOOGLE_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 指定 TaskInstance (GOOGLE 由来) の Google event を削除する。
// 404 (既に Google 側で消えていた) は ok 扱い。
//
// Phase 6: 削除と同時に GoogleTombstone を upsert する。
// Google 側 API が失敗してローカルだけ消えた場合、次回 sync が events.list で
// 同じ event を引いてきて再生成してしまう問題への対処。tombstone があれば
// sync 側で再生成を skip する (30 日で expire)。
//
// 戻り値は ok でも fail でも tombstone は書く (= ok=false でもローカルから
// 行は消えたという前提で、Google が消えるまで再生成しないことを意図)。
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
    return { ok: false, error: "not a google-sourced task" };
  }

  // まず tombstone を upsert (Google API 呼ぶ前に確実に記録)。
  // 30 日間 sync の再生成をブロックする。
  const now = new Date();
  await prisma.googleTombstone.upsert({
    where: {
      googleCalendarId_externalEventId: {
        googleCalendarId: ti.googleCalendarId,
        externalEventId: ti.sourceExternalId,
      },
    },
    create: {
      googleCalendarId: ti.googleCalendarId,
      externalEventId: ti.sourceExternalId,
      deletedAt: now,
      expiresAt: new Date(now.getTime() + GOOGLE_TOMBSTONE_TTL_MS),
    },
    update: {
      deletedAt: now,
      expiresAt: new Date(now.getTime() + GOOGLE_TOMBSTONE_TTL_MS),
    },
  });

  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(ti.googleCalendar.credential);
  } catch (e) {
    return { ok: false, error: `access_token: ${(e as Error).message}` };
  }
  const url = `${EVENTS_API_BASE}/${encodeURIComponent(ti.googleCalendar.externalId)}/events/${encodeURIComponent(ti.sourceExternalId)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404 || res.status === 410) return { ok: true }; // 既に消えている
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `events.delete ${res.status} ${detail.slice(0, 200)}` };
  }
  return { ok: true };
}
