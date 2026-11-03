import { describe, expect, it } from "vitest";
import { deriveRoomId, noQrRoomId, normalizeNoQrSettings } from "@/lib/attendance/noQr";
import { attendanceRoomMatches } from "@/lib/attendance/room-normalize";

describe("deriveRoomId", () => {
  it("津田沼の 7 号館 7XY は 7X0Y にする (実機 QR: 731講義室 = 7301)", () => {
    expect(deriveRoomId("７３１講義室")).toBe("7301");
    expect(deriveRoomId("７２２演習室")).toBe("7202");
  });
  it("作った番号は時間割の教室と一致判定される", () => {
    expect(attendanceRoomMatches("７３１講義室", deriveRoomId("７３１講義室"))).toBe(true);
    expect(attendanceRoomMatches("６１４講義室", deriveRoomId("６１４講義室"))).toBe(true);
  });
  it("7 号館以外の津田沼 (3 桁) と新習志野 (4 桁) は教室番号そのまま", () => {
    expect(deriveRoomId("６１４講義室")).toBe("614");
    expect(deriveRoomId("６１２講義室")).toBe("612");
    expect(deriveRoomId("１２３４講義室")).toBe("1234");
  });
  it("数字でない教室は作らない", () => {
    expect(deriveRoomId("鎌倉研")).toBeNull();
    expect(deriveRoomId(null)).toBeNull();
    expect(deriveRoomId("")).toBeNull();
  });
});

describe("noQrRoomId", () => {
  it("教室ごとの手入力を優先する", () => {
    expect(noQrRoomId({ rooms: { 鎌倉研: "K101" } }, "鎌倉研")).toBe("K101");
    expect(noQrRoomId({ rooms: { "７３１講義室": "9999" } }, "７３１講義室")).toBe("9999");
  });
  it("手入力が無ければ教室名から作る", () => {
    expect(noQrRoomId({ rooms: {} }, "７３１講義室")).toBe("7301");
    expect(noQrRoomId({ rooms: {} }, "鎌倉研")).toBeNull();
  });
});

describe("normalizeNoQrSettings", () => {
  it("未設定・壊れた値はオフ", () => {
    expect(normalizeNoQrSettings(undefined)).toEqual({ all: false, rooms: {} });
    expect(normalizeNoQrSettings({ all: "yes" })).toEqual({ all: false, rooms: {} });
  });
  it("以前の授業ごとの配列は、登録があればオンに読み替える", () => {
    expect(normalizeNoQrSettings([{ courseName: "x" }])).toEqual({ all: true, rooms: {} });
    expect(normalizeNoQrSettings([])).toEqual({ all: false, rooms: {} });
  });
  it("新しい形式はそのまま", () => {
    expect(normalizeNoQrSettings({ all: true, rooms: { 鎌倉研: "K101" } })).toEqual({
      all: true,
      rooms: { 鎌倉研: "K101" },
    });
  });
});
