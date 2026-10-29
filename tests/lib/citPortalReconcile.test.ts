import { describe, expect, it } from "vitest";
import { pickStaleClassIds } from "@/lib/citPortalReconcile";

// CIT 同期の effectiveFrom(UTC 保存、JST の 4/1・10/1 0:00)
const FY2025_FIRST = new Date("2025-03-31T15:00:00Z");
const FY2026_FIRST = new Date("2026-03-31T15:00:00Z");
const FY2026_SECOND = new Date("2026-09-30T15:00:00Z");
const FY2027_FIRST = new Date("2027-03-31T15:00:00Z");

describe("pickStaleClassIds", () => {
  it("同じ年度で今回の結果に無い行は削除対象(履修取り消しなど)", () => {
    const existing = [
      { id: 1, effectiveFrom: FY2026_FIRST },
      { id: 2, effectiveFrom: FY2026_SECOND },
    ];
    const scraped = [{ effectiveFrom: FY2026_SECOND }];
    expect(pickStaleClassIds(existing, scraped, (e) => e.id === 2)).toEqual([1]);
  });

  it("年度をまたいだ同期では過去年度の行を残す", () => {
    const existing = [
      { id: 1, effectiveFrom: FY2025_FIRST },
      { id: 2, effectiveFrom: FY2026_FIRST },
      { id: 3, effectiveFrom: FY2026_SECOND },
    ];
    // 2027 年度になり、ポータルは 2027 年度分だけを返す
    const scraped = [{ effectiveFrom: FY2027_FIRST }];
    expect(pickStaleClassIds(existing, scraped, () => false)).toEqual([]);
  });

  it("effectiveFrom の無い同期行は従来どおり置き換え対象", () => {
    const existing = [
      { id: 1, effectiveFrom: null },
      { id: 2, effectiveFrom: FY2025_FIRST },
    ];
    const scraped = [{ effectiveFrom: FY2026_FIRST }];
    expect(pickStaleClassIds(existing, scraped, () => false)).toEqual([1]);
  });

  it("今回の結果に含まれる行は消さない", () => {
    const existing = [{ id: 1, effectiveFrom: FY2026_FIRST }];
    const scraped = [{ effectiveFrom: FY2026_FIRST }];
    expect(pickStaleClassIds(existing, scraped, () => true)).toEqual([]);
  });
});
