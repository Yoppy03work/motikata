import { describe, expect, it } from "vitest";
import {
  normalizeRoom,
  attendanceRoomMatches,
} from "@/lib/attendance/room-normalize";

describe("normalizeRoom", () => {
  it("全角数字 + 種別 suffix を剥がしてコアを出す", () => {
    expect(normalizeRoom("７３１講義室").core).toBe("731");
  });
  it("日本語のみはコア null", () => {
    expect(normalizeRoom("オンライン").core).toBeNull();
  });
  it("null/空は isEmpty", () => {
    expect(normalizeRoom(null).isEmpty).toBe(true);
    expect(normalizeRoom("   ").isEmpty).toBe(true);
  });
});

describe("attendanceRoomMatches", () => {
  it("津田沼 7 始まり 3 桁 → QR 4 桁 (0 挿入) を一致", () => {
    expect(attendanceRoomMatches("７３１講義室", "7301")).toBe(true);
    expect(attendanceRoomMatches("731", "7301")).toBe(true);
  });
  it("完全一致 (新習志野 native 4 桁含む)", () => {
    expect(attendanceRoomMatches("7301", "7301")).toBe(true);
  });
  it("別教室は不一致", () => {
    expect(attendanceRoomMatches("732", "7301")).toBe(false);
    expect(attendanceRoomMatches("731", "7311")).toBe(false);
  });
  it("空 room は一致とみなさない", () => {
    expect(attendanceRoomMatches(null, "7301")).toBe(false);
    expect(attendanceRoomMatches("", "7301")).toBe(false);
  });
  it("コアが取れない表記 (オンライン) は数値 QR と不一致", () => {
    expect(attendanceRoomMatches("オンライン", "7301")).toBe(false);
  });
});
