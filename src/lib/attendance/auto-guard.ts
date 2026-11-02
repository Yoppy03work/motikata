/**
 * 出席 auto 実行の最終ゲート (純粋関数)
 *
 * ChibaTechPortal の attendance-auto-guard.ts を単一ユーザー向けに移植 (2026-11-02)。
 * 所有チェックは単一ユーザーのため不要。2 段階ガード (pre-network → healthCheck → full) は維持。
 *
 * WHY: 外部システムへの実アクセスは adapter.attend() だけでなく healthCheck() でも起きる。
 * env disabled / mode 不一致 / 重複 / qrSessionValid=false など DB・内部状態だけで reject
 * できるなら healthCheck も呼ばない (pre-network で即 reject)。
 */
import type { AttendanceMode } from "./settings";
import { attendanceRoomMatches } from "./room-normalize";
import { isInAttendanceWindow } from "./time";

export interface AttendanceAutoGuardPreNetworkInput {
  autoExecutionEnabled: boolean;
  method: AttendanceMode;
  storedMode: AttendanceMode;
  classroom: string | null | undefined;
  jobRoomId: string;
  classDayOfWeek: number;
  classStartMinutes: number;
  now: Date;
  alreadySubmitted: boolean;
  qrSessionValid: boolean;
}

export interface AttendanceAutoGuardInput extends AttendanceAutoGuardPreNetworkInput {
  campusReachable: boolean;
}

export type AttendanceAutoGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/** 外部アクセス前に判定可能な条件のみ評価する (healthCheck を呼ぶ前)。 */
export function evaluateAttendanceAutoGuardPreNetwork(
  input: AttendanceAutoGuardPreNetworkInput,
): AttendanceAutoGuardResult {
  if (!input.autoExecutionEnabled) {
    return { allowed: false, reason: "auto attendance execution is disabled by server policy" };
  }
  if (input.method !== "auto") {
    return { allowed: false, reason: "attendance worker only submits auto jobs" };
  }
  if (input.storedMode !== "auto") {
    return { allowed: false, reason: "user has not enabled auto attendance" };
  }
  if (!attendanceRoomMatches(input.classroom, input.jobRoomId)) {
    return { allowed: false, reason: "job room does not match timetable room" };
  }
  if (!isInAttendanceWindow(input.now, input.classDayOfWeek, input.classStartMinutes)) {
    return { allowed: false, reason: "current time does not match target class period" };
  }
  if (!input.qrSessionValid) {
    return { allowed: false, reason: "QR-derived attendance session is not verified" };
  }
  if (input.alreadySubmitted) {
    return { allowed: false, reason: "attendance was already submitted for this class date" };
  }
  return { allowed: true };
}

/**
 * 全条件を評価する。pre-network が通過した後に campusReachable を含めて判定。
 * 呼び出し側は必ず pre-network → reject なら return → healthCheck → 本関数 の順を守ること。
 */
export function evaluateAttendanceAutoGuard(
  input: AttendanceAutoGuardInput,
): AttendanceAutoGuardResult {
  const pre = evaluateAttendanceAutoGuardPreNetwork(input);
  if (!pre.allowed) return pre;
  if (!input.campusReachable) {
    return { allowed: false, reason: "attendance system is not reachable from campus network" };
  }
  return { allowed: true };
}
