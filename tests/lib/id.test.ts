import { describe, expect, it } from "vitest";
import { INT4_MAX, parseId } from "@/lib/id";
import { TaskCreateInput, TaskListQuery } from "@/lib/validation/task";

describe("parseId", () => {
  it("正の整数文字列を数値にする", () => {
    expect(parseId("1")).toBe(1);
    expect(parseId(String(INT4_MAX))).toBe(INT4_MAX);
  });

  it("int4 を超える値は null (Prisma に渡ると 500 になるため)", () => {
    expect(parseId(String(INT4_MAX + 1))).toBeNull();
    expect(parseId("99999999999999999999")).toBeNull();
  });

  it("0・負数・小数・非数値は null", () => {
    for (const raw of ["0", "-1", "1.5", "abc", "", "1e3x", "Infinity"]) {
      expect(parseId(raw)).toBeNull();
    }
  });
});

describe("TaskCreateInput の上限", () => {
  const base = { title: "t", dueAt: "2026-11-01T10:00:00+09:00" };

  it("通常の入力は通る", () => {
    const r = TaskCreateInput.safeParse({
      ...base,
      tagIds: [1, 2],
      reminders: [{ offsetMin: -30, channel: "PUSH" }],
    });
    expect(r.success).toBe(true);
  });

  it("tagIds が多すぎる・範囲外なら弾く", () => {
    const many = Array.from({ length: 51 }, (_, i) => i + 1);
    expect(TaskCreateInput.safeParse({ ...base, tagIds: many }).success).toBe(false);
    expect(
      TaskCreateInput.safeParse({ ...base, tagIds: [INT4_MAX + 1] }).success,
    ).toBe(false);
  });

  it("offsetMin が ±1 年を超えると弾く (Date の範囲外で 500 になるのを防ぐ)", () => {
    const r = TaskCreateInput.safeParse({
      ...base,
      reminders: [{ offsetMin: 1e12, channel: "PUSH" }],
    });
    expect(r.success).toBe(false);
  });

  it("checklist / reminders の件数上限", () => {
    const checklist = Array.from({ length: 101 }, () => ({ label: "x" }));
    expect(TaskCreateInput.safeParse({ ...base, checklist }).success).toBe(false);
    const reminders = Array.from({ length: 21 }, () => ({
      offsetMin: 0,
      channel: "PUSH",
    }));
    expect(TaskCreateInput.safeParse({ ...base, reminders }).success).toBe(false);
  });

  it("一覧クエリの tagId も int4 範囲に制限する", () => {
    expect(TaskListQuery.safeParse({ tagId: "3" }).data?.tagId).toBe(3);
    expect(TaskListQuery.safeParse({ tagId: "99999999999" }).success).toBe(false);
  });
});
