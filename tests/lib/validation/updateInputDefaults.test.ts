import { describe, it, expect } from "vitest";
import { ClassCreateInput, ClassUpdateInput } from "@/lib/validation/class";
import { TemplateCreateInput, TemplateUpdateInput } from "@/lib/validation/template";

// zod 4 では partial() しても内側の default が適用される。
// Update スキーマが既定値を埋めると PATCH で未指定のフィールドが上書きされるため、
// 「送っていないキーは出てこない」ことを固定する。
describe("Update スキーマは default を埋めない", () => {
  it("ClassUpdateInput: 未指定キーは undefined のまま", () => {
    expect(ClassUpdateInput.parse({ courseName: "数学" })).toEqual({ courseName: "数学" });
  });

  it("TemplateUpdateInput: 未指定キーは undefined のまま", () => {
    expect(TemplateUpdateInput.parse({ title: "朝" })).toEqual({ title: "朝" });
  });

  it("Create 側は従来どおり default が入る", () => {
    const c = ClassCreateInput.parse({
      dayOfWeek: 1,
      period: 1,
      startTime: "09:00",
      endTime: "10:30",
      courseName: "数学",
    });
    expect(c.tagIds).toEqual([]);
    expect(c.reminders).toHaveLength(2);

    const t = TemplateCreateInput.parse({ title: "朝", rrule: "FREQ=DAILY" });
    expect(t.priority).toBe("MID");
    expect(t.defaultDueOffsetMin).toBe(0);
  });
});
