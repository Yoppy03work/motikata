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

import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "./db";
import { ensureGoogleAccessToken } from "./googleAccessToken";

const EVENTS_API_BASE = "https://www.googleapis.com/calendar/v3/calendars";

// Phase 11: DateTime を JST 暦の YYYY-MM-DD に整形 (Google all-day 用)。
function formatJstYmd(d: Date): string {
  return formatInTimeZone(d, "Asia/Tokyo", "yyyy-MM-dd");
}

// Phase 14d: Google calendarList の accessRole から「書き込み可能か」を判定。
// "owner" / "writer" のみ書き込み許容。"reader" / "freeBusyReader" は read-only。
// legacy 行 (accessRole NULL; Phase 14d migration 前から取り込み済) は不明なので
// graceful degradation で write を許容 → 403 を Google に任せる (旧挙動と同じ)。
function isWritableAccessRole(accessRole: string | null | undefined): boolean {
  if (!accessRole) return true; // legacy fallback
  return accessRole === "owner" || accessRole === "writer";
}

// Phase 11/12: Google API の生 error body をユーザーに返さず、status コードと
// 大分類だけ返すヘルパ。raw body は呼び出し側で console.error にログ。
//
// Phase 12: 403 は rate/quota (transient) と真の forbidden が混ざるため、
// 呼び出し側で isTransient403 判定済みなら kind="transient" を渡し、不要な
// 「再連携してください」誘導を避ける。tombstone SHORT で自動 retry される
// ことを案内する。
// Phase 12: PII redaction for server-side logs。
// primary calendar の externalId = ユーザーの email address。Google API の
// 404/403/error body はリソースパスや calendarId を echo するため、生 body を
// console.error に流すと email が log aggregator に流れる懸念がある。
// メアド/長い token をマスクしてから log に書く。
function redactSensitive(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[redacted-email]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted-token]");
}

type GoogleErrorKind = "auth" | "transient";
function googleErrorMessage(
  op: string,
  status: number,
  kind?: GoogleErrorKind,
): string {
  if (status === 401) {
    return `Google 認証エラー (${op} ${status})。設定から再連携してください`;
  }
  if (status === 403) {
    if (kind === "transient") {
      return `Google API のレート/クォータ上限です (${op})。バックグラウンドで自動再試行されます`;
    }
    return `Google 権限エラー (${op} ${status})。カレンダーの共有設定または再連携をご確認ください`;
  }
  if (status === 429) {
    return `Google API のレート制限に達しました (${op})。しばらくしてから再試行してください`;
  }
  if (status >= 500) {
    return `Google API が一時的に応答していません (${op} ${status})。再試行してください`;
  }
  return `Google API エラー (${op} ${status})`;
}

// Phase 11: Google event を GET して all-day (start.date) か timed
// (start.dateTime) かを判定する。Patch 時に既存形式を保持するために使う。
// 失敗時は null を返し、呼び出し側で safe default を選ぶ。
async function detectGoogleEventDateFormat(
  calendarExternalId: string,
  eventExternalId: string,
  accessToken: string,
): Promise<"all-day" | "timed" | null> {
  try {
    const url = `${EVENTS_API_BASE}/${encodeURIComponent(calendarExternalId)}/events/${encodeURIComponent(eventExternalId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      start?: { date?: string; dateTime?: string };
    } | null;
    if (!data || !data.start) return null;
    if (data.start.date) return "all-day";
    if (data.start.dateTime) return "timed";
    return null;
  } catch {
    return null;
  }
}

// Phase 9: Google API 403 の reason を見て transient (rate / quota) か
// 真の forbidden かを判定する。Google Calendar API のエラー応答は通常 JSON で
// `{ error: { errors: [{ domain, reason }], code, message } }` の形。
// 既知の transient reason を列挙。HTML body 等で JSON parse に失敗した場合は
// safe default として「transient と仮定 → SHORT TTL」を選ぶ。間違えても 1 時間
// 後に sync で取り込み直されるだけで、真の forbidden を見逃しても致命的では
// ない (権限剥奪なら次回 sync で 403 が再発する)。
// Phase 10: Google Calendar API が 403 で返す既知の transient reason のみ。
// (5xx で返る backendError や documentation に明記されていない曖昧な reason は
//  含めない。確実に 403 として観測される rate / quota 系のみ)。
const TRANSIENT_403_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "rateLimitExceededUnreg",
  "userRateLimitExceededUnreg",
  "quotaExceeded",
  "dailyLimitExceeded",
  "dailyLimitExceededUnreg",
]);
function isTransient403(body: string): boolean {
  if (!body) return true; // 空 body は parse 不能 → safe default
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[] };
    };
    const reasons = parsed.error?.errors?.map((e) => e.reason) ?? [];
    if (reasons.length === 0) return true; // reason 不明 → safe default
    return reasons.some((r) => r && TRANSIENT_403_REASONS.has(r));
  } catch {
    // 非 JSON (HTML 403 等) → safe default
    return true;
  }
}

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
      // Phase 13: ローカル endAt / isAllDay を見て event 形式を保持する。
      // GET fallback は次の trade-off として残しておく (ローカルが古い場合の保険)。
      endAt: true,
      isAllDay: true,
      googleCalendar: { select: { externalId: true, credential: true, accessRole: true } },
    },
  });
  if (!ti) return { ok: false, error: "not found" };
  if (ti.source !== "GOOGLE" || !ti.sourceExternalId || !ti.googleCalendar) {
    return { ok: false, error: "not a google-sourced task" };
  }
  // Phase 14d: read-only calendar への write を Google 呼ぶ前に reject。
  // 403 loop / rate limit 浪費を防ぐ。
  if (!isWritableAccessRole(ti.googleCalendar.accessRole)) {
    return {
      ok: false,
      error: "このカレンダーは読み取り専用です。Google 側で書き込み権限を確認してください",
    };
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
    // Phase 13: ローカル isAllDay / endAt から形式を決定する。
    // Phase 11 では毎回 GET していたが、Phase 13 で endAt/isAllDay を保持する
    // ようにしたのでローカル情報で十分。ローカルが NULL の legacy 行のみ
    // GET fallback で形式判定 (Phase 11 と同じ).
    let useAllDay = ti.isAllDay;
    if (ti.endAt === null && ti.isAllDay === false) {
      // legacy 行 (Phase 13 migration 前に取り込み、それ以降 Google から
      // 更新されてない) は形式情報が無いので GET fallback。
      const existingFormat = await detectGoogleEventDateFormat(
        ti.googleCalendar.externalId,
        ti.sourceExternalId,
        accessToken,
      );
      useAllDay = existingFormat === "all-day";
    }
    if (useAllDay) {
      const ymdJst = formatJstYmd(patch.dueAt);
      // Phase 13: ローカル endAt を持っていればそれを exclusive end として
      // 使う (multi-day all-day の保持)。無ければ翌日 = single day。
      // Phase 13.5: end <= start で Google 400 が出ないよう safety guard。
      // PATCH route で delta shift が効いていれば通常はここに到達しないが、
      // legacy 行や endAt 未保存の場合の保険として確保。
      let endDate = ti.endAt ?? new Date(patch.dueAt.getTime() + 24 * 60 * 60 * 1000);
      if (endDate.getTime() <= patch.dueAt.getTime()) {
        endDate = new Date(patch.dueAt.getTime() + 24 * 60 * 60 * 1000);
      }
      const nextDayJst = formatJstYmd(endDate);
      body.start = { date: ymdJst };
      body.end = { date: nextDayJst };
    } else {
      const iso = patch.dueAt.toISOString();
      body.start = { dateTime: iso, timeZone: "Asia/Tokyo" };
      // Phase 13: ローカル endAt を持っていれば duration を維持する。
      // 無ければ dueAt + 1h を fallback とする (Phase 1 〜 12 と同じ挙動)。
      // また dueAt 変更で endAt が逆転 (end <= start) する場合も +1h に補正。
      let endDt = ti.endAt;
      if (!endDt || endDt.getTime() <= patch.dueAt.getTime()) {
        endDt = new Date(patch.dueAt.getTime() + 60 * 60 * 1000);
      }
      body.end = { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" };
    }
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
    // Phase 11: raw Google API error body をユーザーに返さない。
    // サーバーログには truncated + PII redacted の detail を残し、
    // client には status のみ返す。
    console.error(
      `[google] events.patch ${res.status} for task ${ti.id}: ${redactSensitive(detail).slice(0, 200)}`,
    );
    return { ok: false, error: googleErrorMessage("events.patch", res.status) };
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
  // Phase 13: 任意。指定すれば duration を保持して Google に作成。
  // 未指定なら従来通り dueAt + 1h end (timed) で作成。
  endAt?: Date | null;
  // Phase 13: true なら all-day event として作成 (start.date / end.date)。
  // 未指定なら timed として作成。all-day の end は exclusive (+1day default)。
  isAllDay?: boolean;
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
      accessRole: true,
    },
  });
  if (!cal) return { ok: false, error: "calendar not found" };
  if (!cal.enabled) return { ok: false, error: "calendar disabled" };
  // Phase 14d: read-only calendar への insert は Google 呼ぶ前に reject。
  if (!isWritableAccessRole(cal.accessRole)) {
    return {
      ok: false,
      error: "このカレンダーは読み取り専用です。書き込み可能なカレンダーを選んでください",
    };
  }

  let accessToken: string;
  try {
    accessToken = await ensureGoogleAccessToken(cal.credential);
  } catch (e) {
    return { ok: false, error: `access_token: ${(e as Error).message}` };
  }

  // Phase 13: isAllDay フラグで body 構築を分岐。
  // - all-day: start.date / end.date (end は exclusive。+1day default)
  // - timed: start.dateTime / end.dateTime (end は inclusive。endAt 指定または
  //          dueAt + 1h fallback)
  const baseBody = {
    summary: payload.title,
    description: payload.notes ?? "",
  };
  let body: Record<string, unknown>;
  if (payload.isAllDay) {
    const ymdJst = formatJstYmd(payload.dueAt);
    // Phase 13.5: end<=start で 400 が出ないよう safety guard。caller が
    // endAt を dueAt と同日にした (= 0 日間) ケース等に対する保険。
    let endDate = payload.endAt ?? new Date(payload.dueAt.getTime() + 24 * 60 * 60 * 1000);
    if (endDate.getTime() <= payload.dueAt.getTime()) {
      endDate = new Date(payload.dueAt.getTime() + 24 * 60 * 60 * 1000);
    }
    const nextDayJst = formatJstYmd(endDate);
    body = {
      ...baseBody,
      start: { date: ymdJst },
      end: { date: nextDayJst },
    };
  } else {
    const iso = payload.dueAt.toISOString();
    let endDt = payload.endAt;
    if (!endDt || endDt.getTime() <= payload.dueAt.getTime()) {
      endDt = new Date(payload.dueAt.getTime() + 60 * 60 * 1000);
    }
    body = {
      ...baseBody,
      start: { dateTime: iso, timeZone: "Asia/Tokyo" },
      end: { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" },
    };
  }

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
    console.error(
      `[google] events.insert ${res.status} for calendar ${googleCalendarId}: ${redactSensitive(detail).slice(0, 200)}`,
    );
    return {
      ok: false,
      error: googleErrorMessage("events.insert", res.status),
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

// Phase 7/8/9: POST /api/tasks の transaction が createGoogleEvent 成功後に失敗
// した際の Google 側 orphan event を消すためのヘルパ。
//
// 動作 (Phase 9 再設計):
//   1. Google DELETE を best-effort で試行 (try/catch で完全に握り潰し)
//   2. DELETE が成功 / 既に消えていた (404/410) 場合のみ tombstone を LONG で書く
//   3. それ以外 (cal なし / token 失敗 / 5xx / network / 401/403 等):
//      tombstone は書かない。次の sync で orphan が phantom task として
//      取り込まれるが、ユーザーが手動で削除して回復可能。
//
// Phase 8 では tombstone を先に書いていたが、(a) writeTombstone 自体が throw
// すると元の transaction エラーを mask する (b) cal が消えていると FK 違反で
// throw する (c) cal/token 失敗時に SHORT tombstone が 1 時間 valid な Google
// event を見えなくする、という新規 regression があった。
//
// Phase 9 の trade-off: orphan が 1 度だけ phantom 取り込みされる可能性は残るが、
// rollback ヘルパ自体が絶対に throw しない / 元エラーを mask しない / valid な
// Google event を意図せず隠さない、という不変条件を優先する。
export async function rollbackOrphanGoogleEvent(
  googleCalendarId: number,
  externalEventId: string,
): Promise<void> {
  // 関数全体を try/catch で包む。本関数は best-effort cleanup なので、
  // どんな例外も呼び出し側 (POST /api/tasks の catch) の `throw e` (= 元の
  // transaction エラー) を mask してはいけない。
  try {
    const cal = await prisma.googleCalendar.findUnique({
      where: { id: googleCalendarId },
      select: { externalId: true, credential: true },
    });
    if (!cal) return;
    let accessToken: string;
    try {
      accessToken = await ensureGoogleAccessToken(cal.credential);
    } catch {
      return; // 取得失敗 → 次の sync で orphan が phantom 取り込みされる
    }
    const url = `${EVENTS_API_BASE}/${encodeURIComponent(cal.externalId)}/events/${encodeURIComponent(externalEventId)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      return; // network 失敗 → 同上
    }
    if (res.status === 404 || res.status === 410 || res.ok) {
      // Google 側で確実に消えた (or 既に消えていた) → tombstone で再取り込み防止
      await writeTombstone(
        googleCalendarId,
        externalEventId,
        GOOGLE_TOMBSTONE_TTL_LONG_MS,
      );
    }
    // それ以外の失敗 (5xx / 401 / 403 / 412 等): tombstone を書かない。
    // 「ローカルには無いが Google にだけ残っている」が一時的に発生するが、
    // 次の sync で取り込まれて回復可能 (ユーザーが手動で削除)。
  } catch {
    // 関数全体は black hole で受ける (例: tombstone upsert で FK 違反等)。
    return;
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
      googleCalendar: { select: { externalId: true, credential: true, accessRole: true } },
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
  // Phase 14d: read-only calendar への delete は Google 呼ぶ前に reject。
  // tombstone を書くことで「ローカル意図は記録、Google には残る」が達成され、
  // 次回 sync で event は復元されない (30 日)。これは妥当な挙動。
  if (!isWritableAccessRole(ti.googleCalendar.accessRole)) {
    await writeTombstone(
      ti.googleCalendarId,
      ti.sourceExternalId,
      GOOGLE_TOMBSTONE_TTL_LONG_MS,
    );
    return {
      ok: false,
      error: "このカレンダーは読み取り専用のため Google 側からは削除できません。ローカルからは消えています",
    };
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
    console.error(
      `[google] events.delete network for task ${taskInstanceId}: ${(e as Error).message}`,
    );
    return {
      ok: false,
      error: "Google API ネットワークエラー。再試行してください",
    };
  }
  if (res.status === 404 || res.status === 410) {
    // 既に Google 側で消えていた = 成功扱い。LONG で抑える (再取り込み防止)。
    await writeTombstone(ti.googleCalendarId, ti.sourceExternalId, GOOGLE_TOMBSTONE_TTL_LONG_MS);
    return { ok: true };
  }
  if (res.status === 401 || res.status === 403) {
    // 403 は『rateLimitExceeded / userRateLimitExceeded / dailyLimitExceeded /
    // quotaExceeded / *Unreg』のような transient と、『forbidden』のような
    // 真の認可失敗が混ざる。
    //   - 401: 必ず tombstone 書かない (credential 故障)
    //   - 403 で transient reason 検出 or body JSON parse 不能: SHORT TTL
    //     (safe default = transient と仮定。間違えても 1h 後に取り込み直し)
    //   - 403 で明示的 forbidden reason: tombstone 書かない
    const detail = await res.text().catch(() => "");
    let kind: "auth" | "transient" | undefined;
    if (res.status === 403) {
      const isTransient = isTransient403(detail);
      if (isTransient) {
        await writeTombstone(
          ti.googleCalendarId,
          ti.sourceExternalId,
          GOOGLE_TOMBSTONE_TTL_SHORT_MS,
        );
        kind = "transient";
      }
    }
    console.error(
      `[google] events.delete ${res.status} for task ${taskInstanceId}: ${redactSensitive(detail).slice(0, 200)}`,
    );
    return {
      ok: false,
      error: googleErrorMessage("events.delete", res.status, kind),
    };
  }
  if (!res.ok) {
    // 5xx / rate limit / その他失敗。SHORT TTL で次回 cron に賭ける。
    await writeTombstone(ti.googleCalendarId, ti.sourceExternalId, GOOGLE_TOMBSTONE_TTL_SHORT_MS);
    const detail = await res.text().catch(() => "");
    console.error(
      `[google] events.delete ${res.status} for task ${taskInstanceId}: ${redactSensitive(detail).slice(0, 200)}`,
    );
    return { ok: false, error: googleErrorMessage("events.delete", res.status) };
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
