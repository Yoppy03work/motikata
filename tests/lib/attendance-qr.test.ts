import { describe, expect, it } from "vitest";
import { parseAttendanceQrUrl } from "@/lib/attendance/qr";

describe("parseAttendanceQrUrl", () => {
  it("chibatech の native 出席 QR を受理", () => {
    const r = parseAttendanceQrUrl(
      "https://attendance.is.chibatech.ac.jp/attendance/class_room/7301",
    );
    expect(r).toEqual({ ok: true, roomId: "7301" });
  });

  it("旧 it-chiba ドメインも後方互換で受理", () => {
    const r = parseAttendanceQrUrl(
      "https://attendance.is.it-chiba.ac.jp/attendance/class_room/A-101",
    );
    expect(r.ok).toBe(true);
  });

  it("http は拒否", () => {
    expect(parseAttendanceQrUrl("http://attendance.is.chibatech.ac.jp/attendance/class_room/7301")).toEqual(
      { ok: false, reason: "unsupported_protocol" },
    );
  });

  it("許可外ホストは拒否", () => {
    expect(parseAttendanceQrUrl("https://evil.example.com/attendance/class_room/7301")).toEqual({
      ok: false,
      reason: "host_not_allowed",
    });
  });

  it("想定外パスは拒否", () => {
    expect(parseAttendanceQrUrl("https://attendance.is.chibatech.ac.jp/attendance/login")).toEqual({
      ok: false,
      reason: "unsupported_path",
    });
  });

  it("不正な roomId 文字は拒否", () => {
    expect(
      parseAttendanceQrUrl("https://attendance.is.chibatech.ac.jp/attendance/class_room/..%2Fetc"),
    ).toEqual({ ok: false, reason: "invalid_room_id" });
  });

  it("URL でない文字列は拒否", () => {
    expect(parseAttendanceQrUrl("not a url")).toEqual({ ok: false, reason: "invalid_url" });
  });
});
