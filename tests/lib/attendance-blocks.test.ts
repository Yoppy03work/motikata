import { describe, expect, it } from "vitest";
import { blockRowIds } from "@/lib/attendance/blocks";

describe("blockRowIds", () => {
  const contiguous = [
    { id: 1, courseName: "情報理論", period: 9 },
    { id: 2, courseName: "情報理論", period: 10 },
    { id: 3, courseName: "ゼミ", period: 3 },
  ];

  it("連続コマ同名授業は 1 ブロック", () => {
    expect(blockRowIds(contiguous, 1).sort()).toEqual([1, 2]);
    expect(blockRowIds(contiguous, 2).sort()).toEqual([1, 2]);
  });

  it("別授業は単独ブロック", () => {
    expect(blockRowIds(contiguous, 3)).toEqual([3]);
  });

  it("同じ日の非連続同名授業 (補講) は別ブロック", () => {
    const makeup = [
      { id: 1, courseName: "A", period: 1 },
      { id: 2, courseName: "A", period: 2 },
      { id: 3, courseName: "A", period: 7 },
    ];
    expect(blockRowIds(makeup, 1).sort()).toEqual([1, 2]);
    expect(blockRowIds(makeup, 3)).toEqual([3]);
  });

  it("存在しない id は安全側でその id のみ", () => {
    expect(blockRowIds(contiguous, 99)).toEqual([99]);
  });
});
