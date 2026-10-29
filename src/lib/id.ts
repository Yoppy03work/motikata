import { z } from "zod";

// Prisma の Int (Postgres int4) の上限。これを超える値をクエリに渡すと
// Prisma が例外を投げて 500 になるので、入口で 400 として弾く。
export const INT4_MAX = 2_147_483_647;

/** URL パスの id 文字列を正の int4 に変換する。範囲外・非整数は null。 */
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= INT4_MAX ? n : null;
}

/** リクエストボディ中の id (正の int4)。 */
export const zId = z.number().int().min(1).max(INT4_MAX);

/** 並び順などの 0 以上の int4。 */
export const zOrderIdx = z.number().int().min(0).max(INT4_MAX);

// リマインダー等の「期日からのずれ(分)」。±1 年に制限する。
// 無制限だと `due + offsetMin * 60_000` が Date の範囲を超え、
// toISOString() が RangeError を投げて 500 になる。
const MINUTES_PER_YEAR = 60 * 24 * 366;
export const zOffsetMin = z.number().int().min(-MINUTES_PER_YEAR).max(MINUTES_PER_YEAR);

// 1 リクエストで受け付ける配列の上限(UI で現実的に使う量より十分大きい値)。
export const MAX_TAG_IDS = 50;
export const MAX_CHECKLIST_ITEMS = 100;
export const MAX_REMINDERS = 20;
