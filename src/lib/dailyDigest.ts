// 締切のまとめ通知(1 日 1 回〜数回)。
//   「今日 1 件・明日 2 件・7 日以内 3 件」のように、締切が近い未完了タスクを 1 通にまとめて送る。
//   直前のチェック(manaba の締切 1 時間前など)では間に合わないことがあるので、その手前で気づけるようにする。
//
//   - 送る時刻は利用者が設定画面でアラームのように追加・削除する(既定は 21:00)
//   - worker が毎分 /api/jobs/daily-digest を叩き、直近の予定時刻を過ぎていて未送信なら送る
//   - Mac のスリープなどで予定時刻から CATCH_UP_MS 以上過ぎたものは送らない(古いまとめは役に立たない)
//   - 締切が近いタスクが 1 件もなければ送らない

import { formatInTimeZone } from "date-fns-tz";
import { ja } from "date-fns/locale/ja";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { deliver } from "@/lib/notify";
import type { NotifyMessage } from "@/lib/notifyConfig";
import { APP_TZ } from "@/lib/tz";

export const DIGEST_TIMES_KEY = "daily_digest_times";
const DIGEST_LAST_KEY = "daily_digest_last";
export const DEFAULT_DIGEST_TIMES = ["21:00"];
export const MAX_DIGEST_TIMES = 6;
const CATCH_UP_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const JST_OFFSET_MS = 9 * 60 * 60_000;
const MAX_LINES_PER_SECTION = 5;

export const DigestTimes = z
  .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
  .max(MAX_DIGEST_TIMES)
  .transform((xs) => [...new Set(xs)].sort());

export async function getDigestTimes(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: DIGEST_TIMES_KEY } });
  if (!row) return DEFAULT_DIGEST_TIMES;
  const parsed = DigestTimes.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_DIGEST_TIMES;
}

export async function setDigestTimes(times: string[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: DIGEST_TIMES_KEY },
    create: { key: DIGEST_TIMES_KEY, value: times },
    update: { value: times },
  });
}

/** JST の日付の 0:00 を UTC の Date で返す。 */
function jstDayStart(d: Date): number {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - JST_OFFSET_MS;
}

/** now 以前で最も新しい予定時刻(今日か昨日の "HH:MM" JST)。時刻が無ければ null。 */
export function latestDigestSlot(times: readonly string[], now: Date): Date | null {
  if (times.length === 0) return null;
  const today = jstDayStart(now);
  let best: number | null = null;
  for (const day of [today, today - DAY_MS]) {
    for (const t of times) {
      const [h, m] = t.split(":").map(Number);
      const slot = day + (h * 60 + m) * 60_000;
      if (slot <= now.getTime() && (best === null || slot > best)) best = slot;
    }
  }
  return best === null ? null : new Date(best);
}

/** その予定時刻のまとめを今送るべきか。 */
export function isDigestDue(slot: Date | null, lastSent: Date | null, now: Date): slot is Date {
  if (!slot) return false;
  if (lastSent && lastSent.getTime() >= slot.getTime()) return false;
  return now.getTime() - slot.getTime() <= CATCH_UP_MS;
}

export type DigestTask = { title: string; dueAt: Date };

/** 締切が近いタスクを「今日 / 明日 / 7 日以内」に分けて 1 通にする。1 件も無ければ null。 */
export function buildDigest(tasks: DigestTask[], now: Date): NotifyMessage | null {
  const today = jstDayStart(now);
  const sections: { label: string; from: number; to: number; format: string }[] = [
    { label: "今日", from: now.getTime(), to: today + DAY_MS, format: "HH:mm" },
    { label: "明日", from: today + DAY_MS, to: today + 2 * DAY_MS, format: "HH:mm" },
    { label: "7 日以内", from: today + 2 * DAY_MS, to: today + 8 * DAY_MS, format: "M/d(E) HH:mm" },
  ];
  const sorted = [...tasks].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const counts: string[] = [];
  const lines: string[] = [];
  for (const s of sections) {
    const hits = sorted.filter((t) => t.dueAt.getTime() >= s.from && t.dueAt.getTime() < s.to);
    if (hits.length === 0) continue;
    counts.push(`${s.label} ${hits.length} 件`);
    lines.push(`【${s.label}】`);
    for (const t of hits.slice(0, MAX_LINES_PER_SECTION)) {
      lines.push(`・${formatInTimeZone(t.dueAt, APP_TZ, s.format, { locale: ja })} ${t.title}`);
    }
    if (hits.length > MAX_LINES_PER_SECTION) lines.push(`  ほか ${hits.length - MAX_LINES_PER_SECTION} 件`);
  }
  if (counts.length === 0) return null;
  return {
    title: `締切まとめ: ${counts.join("・")}`,
    body: lines.join("\n"),
    url: "/today",
    tag: "daily-digest",
  };
}

async function loadDigestTasks(now: Date): Promise<DigestTask[]> {
  return prisma.taskInstance.findMany({
    where: {
      itemType: "TASK",
      status: "OPEN",
      dueAt: { gte: now, lt: new Date(jstDayStart(now) + 8 * DAY_MS) },
    },
    select: { title: true, dueAt: true },
    orderBy: { dueAt: "asc" },
  });
}

export type DigestRunResult =
  | { kind: "not-due" }
  | { kind: "empty"; slot: string }
  | { kind: "sent"; slot: string; partialError: string | null }
  | { kind: "skipped"; slot: string; reason: string }
  | { kind: "failed"; slot: string; error: string };

/** worker から毎分呼ばれる。予定時刻を過ぎていて未送信なら送る。 */
export async function runDailyDigest(now = new Date()): Promise<DigestRunResult> {
  const slot = latestDigestSlot(await getDigestTimes(), now);
  const lastRow = await prisma.setting.findUnique({ where: { key: DIGEST_LAST_KEY } });
  const lastRaw = (lastRow?.value as { slot?: unknown } | undefined)?.slot;
  const lastSent = typeof lastRaw === "string" ? new Date(lastRaw) : null;
  if (!isDigestDue(slot, lastSent, now)) return { kind: "not-due" };

  const markDone = () =>
    prisma.setting.upsert({
      where: { key: DIGEST_LAST_KEY },
      create: { key: DIGEST_LAST_KEY, value: { slot: slot.toISOString() } },
      update: { value: { slot: slot.toISOString() } },
    });

  const msg = buildDigest(await loadDigestTasks(now), now);
  if (!msg) {
    await markDone();
    return { kind: "empty", slot: slot.toISOString() };
  }
  const result = await deliver("ALL", msg);
  // 失敗したときは記録しない(次の分にやり直す。CATCH_UP_MS を過ぎたら諦める)
  if (result.kind === "failed") return { kind: "failed", slot: slot.toISOString(), error: result.error };
  await markDone();
  if (result.kind === "skipped") return { kind: "skipped", slot: slot.toISOString(), reason: result.reason };
  return { kind: "sent", slot: slot.toISOString(), partialError: result.partialError };
}

/** 設定画面の「今すぐ送ってみる」。予定時刻の記録は変えない。 */
export async function sendDigestNow(now = new Date()) {
  const msg = buildDigest(await loadDigestTasks(now), now) ?? {
    title: "締切まとめ: 7 日以内に締切のタスクはありません",
    body: "締切が近いタスクがない日は、まとめ通知は送られません(これは確認用です)",
    url: "/today",
    tag: "daily-digest",
  };
  return deliver("ALL", msg);
}
