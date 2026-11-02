/**
 * 出席 confirm 送信のガード (純粋関数)
 *
 * ChibaTechPortal の attendance-confirm-guard.ts を単一ユーザー向けに移植 (2026-11-02)。
 * モチカタは単一ユーザーなので timetable 所有チェックは不要。それ以外 (room 一致 / 当日 /
 * 時刻ウィンドウ / 重複なし / creds 有り) は同じ。
 *
 * WHY: confirm は「ユーザーが UI で確認後に送信」だが、フロント検証バイパス (直接 POST) を
 * 防ぐためサーバー側でも同じ guard を通す。
 */
import { attendanceRoomMatches } from "./room-normalize";
import { formatJstYmd, isInConfirmWindow } from "./time";

export interface ConfirmSubmitGuardInput {
  /** 出席システム側 roomId (confirm では classSchedule.classroom をそのまま roomId として使う) */
  jobRoomId: string;
  /** ユーザーが確認した授業日 (JST カレンダー日 YYYY-MM-DD) */
  jobClassDateYmd: string;
  /** 時間割の教室表記 (ClassSchedule.classroom) */
  classroom: string | null | undefined;
  classDayOfWeek: number;
  /** ClassSchedule.startTime("HH:mm") を分に直した値 */
  classStartMinutes: number;
  alreadySubmittedConfirm: boolean;
  hasCitCreds: boolean;
  now: Date;
}

export type ConfirmSubmitGuardResult =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "room_mismatch"
        | "outside_time_window"
        | "already_submitted"
        | "credentials_not_registered"
        | "class_date_mismatch";
    };

/**
 * confirm 送信を許可するか判定する (失敗時は最初の reason を返す)。
 *   1. 教室一致 (attendanceRoomMatches)
 *   2. classDate の妥当性 (今日(JST) === jobClassDateYmd)
 *   3. 時刻ウィンドウ (授業開始 5 分前 ±2 分)
 *   4. 同日 confirm 重複なし
 *   5. 認証情報あり
 */
export function evaluateConfirmSubmitGuard(
  input: ConfirmSubmitGuardInput,
): ConfirmSubmitGuardResult {
  if (!attendanceRoomMatches(input.classroom, input.jobRoomId)) {
    return { allowed: false, reason: "room_mismatch" };
  }
  if (input.jobClassDateYmd !== formatJstYmd(input.now)) {
    return { allowed: false, reason: "class_date_mismatch" };
  }
  if (
    !isInConfirmWindow(input.now, input.classDayOfWeek, input.classStartMinutes)
  ) {
    return { allowed: false, reason: "outside_time_window" };
  }
  if (input.alreadySubmittedConfirm) {
    return { allowed: false, reason: "already_submitted" };
  }
  if (!input.hasCitCreds) {
    return { allowed: false, reason: "credentials_not_registered" };
  }
  return { allowed: true };
}
