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
  | { ok: false; error: string };

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
      source: true,
      sourceExternalId: true,
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
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `events.patch ${res.status} ${detail.slice(0, 200)}` };
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
): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
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
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  if (!data.id) return { ok: false, error: "events.insert: response missing id" };
  return { ok: true, eventId: data.id };
}

// 指定 TaskInstance (GOOGLE 由来) の Google event を削除する。
// 404 (既に Google 側で消えていた) は ok 扱い。
export async function deleteGoogleEventForTaskInstance(
  taskInstanceId: number,
): Promise<GoogleWriteResult> {
  const ti = await prisma.taskInstance.findUnique({
    where: { id: taskInstanceId },
    select: {
      source: true,
      sourceExternalId: true,
      googleCalendar: { select: { externalId: true, credential: true } },
    },
  });
  if (!ti) return { ok: false, error: "not found" };
  if (ti.source !== "GOOGLE" || !ti.sourceExternalId || !ti.googleCalendar) {
    return { ok: false, error: "not a google-sourced task" };
  }
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
