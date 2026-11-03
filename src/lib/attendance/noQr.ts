/**
 * 「QR なしで送信」(Setting key="attendance_no_qr")。
 *
 * WHY: 出席 QR は「その教室にいる」ことの確認なので、既定では QR が必須。
 * QR なしでよいと確認できた場合 (学科で全授業可と確認 2026-11-03) に利用者がスイッチを入れると、
 * 時間割のすべての授業で、教室名から出席システムの教室番号を作って送る。
 * 授業ごとの登録はしない (時間割が変わるたび・人によって授業が違うため)。
 * 教室番号の手入力は授業ではなく教室名ごとに持つので、授業が入れ替わっても残る。
 *
 * 教室番号の規則 (利用者に確認済み 2026-11-03):
 *   - 津田沼 7 号館 "7XY" (例 ７３１講義室) → "7X0Y" (7301)。7 号館だけ命名が違う (実機 QR で確認済み)
 *   - 津田沼のほかの号館 (3 桁) → 教室番号そのまま (例 ６１４講義室 → 614)
 *   - 新習志野 (4 桁) → 教室番号そのまま
 *   - 数字でない教室 (研究室名など) は作らない。利用者が設定で教室番号を直接入れる
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeRoom } from "./room-normalize";

export const NO_QR_SETTING_KEY = "attendance_no_qr";
export const MAX_ROOM_OVERRIDES = 50;

export const RoomId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "教室番号は英数字で入力してください");

export const NoQrSettings = z.object({
  // すべての授業で QR なしで送るか
  all: z.boolean(),
  // 教室名 (時間割の表記そのまま) → 教室番号 の手入力
  rooms: z
    .record(z.string().trim().min(1).max(100), RoomId)
    .refine((r) => Object.keys(r).length <= MAX_ROOM_OVERRIDES, "教室が多すぎます"),
});
export type NoQrSettings = z.infer<typeof NoQrSettings>;

const DEFAULT: NoQrSettings = { all: false, rooms: {} };

/** 時間割の教室名から出席システムの教室番号を作る。確信が持てなければ null。 */
export function deriveRoomId(classroom: string | null | undefined): string | null {
  const core = normalizeRoom(classroom).core;
  if (!core) return null;
  if (/^7\d\d$/.test(core)) return `${core.slice(0, 2)}0${core[2]}`;
  if (/^\d{3,4}$/.test(core)) return core;
  return null;
}

/** その教室で使う教室番号 (手入力を優先)。 */
export function noQrRoomId(
  settings: Pick<NoQrSettings, "rooms">,
  classroom: string | null | undefined,
): string | null {
  const key = classroom?.trim();
  return (key && settings.rooms[key]) || deriveRoomId(classroom);
}

/**
 * 保存値を読む。以前の形式 (授業ごとの配列) は、1 件でも登録があれば「すべて」に読み替える
 * (それまでは全授業を登録して使っていたため)。
 */
export function normalizeNoQrSettings(raw: unknown): NoQrSettings {
  if (Array.isArray(raw)) return { all: raw.length > 0, rooms: {} };
  const parsed = NoQrSettings.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT;
}

export async function getNoQrSettings(): Promise<NoQrSettings> {
  const row = await prisma.setting.findUnique({ where: { key: NO_QR_SETTING_KEY } });
  return normalizeNoQrSettings(row?.value);
}

export async function setNoQrSettings(value: NoQrSettings): Promise<void> {
  const v = NoQrSettings.parse(value);
  await prisma.setting.upsert({
    where: { key: NO_QR_SETTING_KEY },
    create: { key: NO_QR_SETTING_KEY, value: v },
    update: { value: v },
  });
}
