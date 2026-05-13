import { describe, expect, it } from "vitest";
import { monthWindow } from "@/lib/indicators";

describe("monthWindow", () => {
  it("月の真ん中: 前後の月を含む", () => {
    expect(monthWindow("2026-05-15")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });

  it("月初(JST 5/1)を UTC ホストでも 5月中心として扱う(=4-6月)", () => {
    // 旧コードの新規回帰テスト: getMonth() ベースだと UTC では 4/30 と
    // 解釈されて 3-5月 window になっていた。
    expect(monthWindow("2026-05-01")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });

  it("1月: 前年12月を含む", () => {
    expect(monthWindow("2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2026-02-28",
    });
  });

  it("12月: 翌年1月を含む", () => {
    expect(monthWindow("2026-12-25")).toEqual({
      from: "2026-11-01",
      to: "2027-01-31",
    });
  });

  it("月末(JST 8/31): 翌月の末日を 9/30 にする", () => {
    expect(monthWindow("2026-08-31")).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
  });

  it("うるう年: 2024-02 中心は 2024-01-01 〜 2024-03-31", () => {
    expect(monthWindow("2024-02-15")).toEqual({
      from: "2024-01-01",
      to: "2024-03-31",
    });
  });
});
