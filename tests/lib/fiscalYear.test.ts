import { describe, expect, it } from "vitest";
import { currentFiscalYear, fiscalYearOf } from "@/lib/fiscalYear";

describe("fiscalYearOf", () => {
  it("JST の 4/1 から新年度 (DB の UTC 値で判定)", () => {
    // CIT 同期の前期開始値: 2026-03-31T15:00Z = 2026-04-01 00:00 JST
    expect(fiscalYearOf(new Date("2026-03-31T15:00:00Z"))).toBe(2026);
    // 1 秒前は 2026-03-31 23:59:59 JST なので前年度
    expect(fiscalYearOf(new Date("2026-03-31T14:59:59Z"))).toBe(2025);
  });

  it("1〜3 月は前年度、後期の開始・終了も同じ年度", () => {
    expect(fiscalYearOf(new Date("2027-02-10T03:00:00Z"))).toBe(2026);
    expect(fiscalYearOf(new Date("2026-09-30T15:00:00Z"))).toBe(2026);
    expect(fiscalYearOf(new Date("2027-03-31T14:59:59Z"))).toBe(2026);
  });

  it("currentFiscalYear は渡した日時の年度", () => {
    expect(currentFiscalYear(new Date("2026-10-30T00:00:00Z"))).toBe(2026);
    expect(currentFiscalYear(new Date("2027-04-01T00:00:00+09:00"))).toBe(2027);
  });
});
