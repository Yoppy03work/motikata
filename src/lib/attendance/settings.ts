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
  // auto 実行が開発者コードで解禁済みか。auto 実送信の有効化はこれ + mode==='auto' が条件。
  autoUnlocked: z.boolean().optional(),
});
export type AttendanceSettings = { mode: AttendanceMode; autoUnlocked: boolean };

/** 未指定時のデフォルト。半自動 (confirm) に倒すのが設計の中核。 */
export const DEFAULT_ATTENDANCE_MODE: AttendanceMode = "confirm";

/**
 * 任意の入力を { mode, autoUnlocked } に正規化する。壊れた値 / null / undefined は
 * DEFAULT (confirm, 未解禁) に倒す (throw しない)。暗黙の auto 昇格・暗黙解禁を防ぐ。
 */
export function normalizeAttendanceSettings(raw: unknown): AttendanceSettings {
  const parsed = attendanceSettingsSchema.safeParse(raw);
  if (parsed.success) {
    return { mode: parsed.data.mode, autoUnlocked: parsed.data.autoUnlocked ?? false };
  }
  return { mode: DEFAULT_ATTENDANCE_MODE, autoUnlocked: false };
}
