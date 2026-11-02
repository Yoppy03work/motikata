/**
 * 出席設定 (Setting テーブルの key="attendance") の入口。
 *
 * ChibaTechPortal の attendance-settings.ts を単一ユーザー向けに移植 (2026-11-02)。
 * 既定は confirm (半自動)。auto は明示選択 + フェーズB の env 解禁が揃うまで実送信しない。
 */
import { z } from "zod";

/** Setting.key。prisma.setting.findUnique/upsert のキー。 */
export const ATTENDANCE_SETTING_KEY = "attendance";

export const attendanceModeSchema = z.enum(["manual", "confirm", "auto"]);
export type AttendanceMode = z.infer<typeof attendanceModeSchema>;

export const attendanceSettingsSchema = z.object({
  mode: attendanceModeSchema,
});
export type AttendanceSettings = z.infer<typeof attendanceSettingsSchema>;

/** 未指定時のデフォルト。半自動 (confirm) に倒すのが設計の中核。 */
export const DEFAULT_ATTENDANCE_MODE: AttendanceMode = "confirm";

/**
 * 任意の入力を { mode } に正規化する。壊れた値 / null / undefined は DEFAULT に倒す (throw しない)。
 * 旧 boolean フラグ { autoAttend } が来ても DEFAULT (confirm) にし、暗黙 auto 昇格を防ぐ。
 */
export function normalizeAttendanceSettings(raw: unknown): AttendanceSettings {
  const parsed = attendanceSettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { mode: DEFAULT_ATTENDANCE_MODE };
}
