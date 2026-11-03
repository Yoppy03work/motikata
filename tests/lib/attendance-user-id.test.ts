import { describe, expect, it } from "vitest";
import { attendanceUserId } from "@/lib/attendance/http";

describe("attendanceUserId", () => {
  it("先頭の英字だけ大文字にする (残りはそのまま)", () => {
    expect(attendanceUserId("s23c1234")).toBe("S23c1234");
    expect(attendanceUserId("s23C1234")).toBe("S23C1234");
  });
  it("すでに大文字・数字始まりはそのまま、前後の空白は落とす", () => {
    expect(attendanceUserId("S23C1234")).toBe("S23C1234");
    expect(attendanceUserId("2312345")).toBe("2312345");
    expect(attendanceUserId(" s23C1234 ")).toBe("S23C1234");
  });
});
