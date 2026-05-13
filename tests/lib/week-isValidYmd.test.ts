import { describe, expect, it } from "vitest";
import { isValidYmd } from "@/lib/week";

describe("isValidYmd", () => {
  it("正常な日付を許容", () => {
    expect(isValidYmd("2026-05-14")).toBe(true);
    expect(isValidYmd("2024-02-29")).toBe(true); // 閏年
    expect(isValidYmd("2026-01-01")).toBe(true);
    expect(isValidYmd("2026-12-31")).toBe(true);
  });

  it("正規表現で弾かれる形式", () => {
    expect(isValidYmd("2026-5-14")).toBe(false); // 1桁月
    expect(isValidYmd("2026/05/14")).toBe(false);
    expect(isValidYmd("")).toBe(false);
    expect(isValidYmd("not-a-date")).toBe(false);
  });

  it("月/日のオーバーフローを弾く", () => {
    expect(isValidYmd("2026-13-40")).toBe(false); // 月=13, 日=40
    expect(isValidYmd("2026-00-15")).toBe(false); // 月=0
    expect(isValidYmd("2026-05-00")).toBe(false); // 日=0
    expect(isValidYmd("2026-05-32")).toBe(false); // 日=32
    expect(isValidYmd("2025-02-30")).toBe(false); // 2月に30日は無い
    expect(isValidYmd("2025-02-29")).toBe(false); // 非閏年の2/29
    expect(isValidYmd("2026-04-31")).toBe(false); // 4月31日は無い
  });
});
