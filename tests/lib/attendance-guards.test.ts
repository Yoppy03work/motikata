import { describe, expect, it } from "vitest";
import { evaluateConfirmSubmitGuard } from "@/lib/attendance/confirm-guard";
import {
  evaluateAttendanceAutoGuardPreNetwork,
} from "@/lib/attendance/auto-guard";

// 2026-11-02 は月曜 (dayOfWeek=1)。17:00 JST = 08:00 UTC。
const MON_1700_JST = new Date("2026-11-02T08:00:00.000Z");
// 16:55 JST = 07:55 UTC (= 17:00 開始の 5 分前 = auto のターゲット)。
const MON_1655_JST = new Date("2026-11-02T07:55:00.000Z");

const baseConfirm = {
  jobRoomId: "7301",
  jobClassDateYmd: "2026-11-02",
  classroom: "731講義室",
  classDayOfWeek: 1,
  classStartMinutes: 17 * 60, // 17:00
  alreadySubmittedConfirm: false,
  hasCitCreds: true,
  now: MON_1700_JST,
};

describe("evaluateConfirmSubmitGuard", () => {
  it("教室一致 + 当日 + 窓内 + 未送信 + creds → allowed", () => {
    expect(evaluateConfirmSubmitGuard(baseConfirm)).toEqual({ allowed: true });
  });
  it("教室不一致 → room_mismatch", () => {
    expect(evaluateConfirmSubmitGuard({ ...baseConfirm, jobRoomId: "999" })).toEqual({
      allowed: false,
      reason: "room_mismatch",
    });
  });
  it("日付不一致 → class_date_mismatch", () => {
    expect(
      evaluateConfirmSubmitGuard({ ...baseConfirm, jobClassDateYmd: "2026-11-01" }),
    ).toEqual({ allowed: false, reason: "class_date_mismatch" });
  });
  it("時間外 (9:00 の授業を 17:00 に) → outside_time_window", () => {
    expect(
      evaluateConfirmSubmitGuard({ ...baseConfirm, classStartMinutes: 9 * 60 }),
    ).toEqual({ allowed: false, reason: "outside_time_window" });
  });
  it("重複 → already_submitted", () => {
    expect(
      evaluateConfirmSubmitGuard({ ...baseConfirm, alreadySubmittedConfirm: true }),
    ).toEqual({ allowed: false, reason: "already_submitted" });
  });
  it("creds 無し → credentials_not_registered", () => {
    expect(evaluateConfirmSubmitGuard({ ...baseConfirm, hasCitCreds: false })).toEqual({
      allowed: false,
      reason: "credentials_not_registered",
    });
  });
});

const baseAuto = {
  autoExecutionEnabled: true,
  method: "auto" as const,
  storedMode: "auto" as const,
  classroom: "731講義室",
  jobRoomId: "7301",
  classDayOfWeek: 1,
  classStartMinutes: 17 * 60,
  now: MON_1655_JST,
  alreadySubmitted: false,
  qrSessionValid: true,
};

describe("evaluateAttendanceAutoGuardPreNetwork", () => {
  it("全条件を満たせば allowed", () => {
    expect(evaluateAttendanceAutoGuardPreNetwork(baseAuto)).toEqual({ allowed: true });
  });
  it("env 未解禁なら必ず reject (dark default / fail-closed)", () => {
    const r = evaluateAttendanceAutoGuardPreNetwork({
      ...baseAuto,
      autoExecutionEnabled: false,
    });
    expect(r.allowed).toBe(false);
  });
  it("storedMode が auto でなければ reject", () => {
    const r = evaluateAttendanceAutoGuardPreNetwork({ ...baseAuto, storedMode: "confirm" });
    expect(r.allowed).toBe(false);
  });
  it("QR セッション未検証なら reject", () => {
    const r = evaluateAttendanceAutoGuardPreNetwork({ ...baseAuto, qrSessionValid: false });
    expect(r.allowed).toBe(false);
  });
});
