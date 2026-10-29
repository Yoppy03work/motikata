import { z } from "zod";
import {
  zId,
  zOrderIdx,
  zOffsetMin,
  MAX_TAG_IDS,
  MAX_CHECKLIST_ITEMS,
  MAX_REMINDERS,
} from "@/lib/id";
import { TaskPriority } from "./enums";

const ChecklistTemplateInput = z.object({
  label: z.string().min(1).max(120),
  orderIdx: zOrderIdx.default(0),
});

// default を持たない素のフィールド定義。zod 4 では partial() しても内側の
// default が適用されるため、Update をこれから作らないと PATCH で未指定の
// priority / tagIds / checklist などが既定値で上書きされてしまう。
const TemplateFields = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  priority: TaskPriority,
  rrule: z.string().min(3).max(500),
  defaultDueOffsetMin: zOffsetMin,
  tagIds: z.array(zId).max(MAX_TAG_IDS),
  checklist: z.array(ChecklistTemplateInput).max(MAX_CHECKLIST_ITEMS),
  reminders: z.array(
    z.object({
      offsetMin: zOffsetMin,
      channel: z.enum(["SLACK", "PUSH"]),
    }),
  ).max(MAX_REMINDERS),
});

export const TemplateCreateInput = TemplateFields.extend({
  priority: TemplateFields.shape.priority.default("MID"),
  defaultDueOffsetMin: TemplateFields.shape.defaultDueOffsetMin.default(0),
  tagIds: TemplateFields.shape.tagIds.default([]),
  checklist: TemplateFields.shape.checklist.default([]),
  reminders: TemplateFields.shape.reminders.default([]),
});
export type TemplateCreateInput = z.infer<typeof TemplateCreateInput>;

export const TemplateUpdateInput = TemplateFields.partial();
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateInput>;
