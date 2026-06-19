// Google カレンダー側への書き戻し (Phase 3)。
//
// 現状サポート:
//   - events.patch: 既存 GOOGLE 由来 TaskInstance の title/notes/dueAt を Google に反映
//
// 未対応 (将来):
//   - events.insert: モチカタで作って Google に push
//   - events.delete: モチカタで削除/SKIPPED 化を Google に反映
//
// patch だけ先に出すのは、ユーザーが Google で作った予定をモチカタ画面から
// 細かい修正 (タイトル変えたい、時間ずらしたい) する需要が一番大きいため。

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
