import { describe, expect, it } from "vitest";
import { deriveRoomId, noQrRoomId } from "@/lib/attendance/noQr";
import { attendanceRoomMatches } from "@/lib/attendance/room-normalize";

describe("deriveRoomId", () => {
  it("津田沼の 7XY は 7X0Y にする (実機 QR: 731講義室 = 7301)", () => {
    expect(deriveRoomId("７３１講義室")).toBe("7301");
    expect(deriveRoomId("７２２演習室")).toBe("7202");
  });
  it("作った番号は時間割の教室と一致判定される", () => {
    expect(attendanceRoomMatches("７３１講義室", deriveRoomId("７３１講義室"))).toBe(true);
  });
  it("4 桁の数字はそのまま", () => {
    expect(deriveRoomId("１２３４講義室")).toBe("1234");
  });
  it("規則が分からない教室は作らない", () => {
    expect(deriveRoomId("６１４講義室")).toBeNull();
    expect(deriveRoomId("鎌倉研")).toBeNull();
    expect(deriveRoomId(null)).toBeNull();
    expect(deriveRoomId("")).toBeNull();
  });
});

describe("noQrRoomId", () => {
  const base = { courseName: "x", note: "先生に確認", enabledAt: "2026-11-03T05:00:00.000Z" };
  it("手入力の教室番号を優先する", () => {
    expect(noQrRoomId({ ...base, roomId: "6104" }, "６１４講義室")).toBe("6104");
  });
  it("手入力が無ければ教室名から作る", () => {
    expect(noQrRoomId(base, "７３１講義室")).toBe("7301");
    expect(noQrRoomId(base, "６１４講義室")).toBeNull();
  });
});
