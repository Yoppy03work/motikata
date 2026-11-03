/**
 * 「QR なしで送信」を許可した授業 (Setting key="attendance_no_qr")。
 *
 * WHY: 出席 QR は「その教室にいる」ことの確認なので、既定では QR が必須。
 * QR なしでよい授業 (学科で全授業可と確認 2026-11-03) を利用者が設定で登録し、
 * 登録した授業は、時間割の教室名から出席システムの教室番号を作って送る。
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
export const MAX_NO_QR_COURSES = 30;

const RoomId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "教室番号は英数字で入力してください");

export const NoQrCourse = z.object({
  courseName: z.string().trim().min(1).max(100),
  // 任意のメモ (以前は必須だった。既存データとの互換のため残す)
  note: z.string().trim().max(200).optional(),
  // 教室番号の手入力。無ければ時間割の教室名から作る
  roomId: RoomId.optional(),
  enabledAt: z.string().datetime({ offset: true }),
});
export type NoQrCourse = z.infer<typeof NoQrCourse>;

const NoQrList = z.array(NoQrCourse).max(MAX_NO_QR_COURSES);

/** 時間割の教室名から出席システムの教室番号を作る。確信が持てなければ null。 */
export function deriveRoomId(classroom: string | null | undefined): string | null {
  const core = normalizeRoom(classroom).core;
  if (!core) return null;
  if (/^7\d\d$/.test(core)) return `${core.slice(0, 2)}0${core[2]}`;
  if (/^\d{3,4}$/.test(core)) return core;
  return null;
}

/** その授業で使う教室番号 (手入力を優先)。 */
export function noQrRoomId(entry: NoQrCourse, classroom: string | null | undefined): string | null {
  return entry.roomId ?? deriveRoomId(classroom);
}

export async function getNoQrCourses(): Promise<NoQrCourse[]> {
  const row = await prisma.setting.findUnique({ where: { key: NO_QR_SETTING_KEY } });
  const parsed = NoQrList.safeParse(row?.value ?? []);
  return parsed.success ? parsed.data : [];
}

export async function setNoQrCourses(list: NoQrCourse[]): Promise<void> {
  const value = NoQrList.parse(list);
  await prisma.setting.upsert({
    where: { key: NO_QR_SETTING_KEY },
    create: { key: NO_QR_SETTING_KEY, value },
    update: { value },
  });
}
