import { z } from "zod";
import {
  zId,
  zOrderIdx,
  zOffsetMin,
  MAX_TAG_IDS,
  MAX_REMINDERS,
  MAX_CHECKLIST_ITEMS,
} from "@/lib/id";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

// default を持たない素のフィールド定義。zod 4 では partial() しても内側の
// default が適用されるため、Update をこれから作らないと PATCH で未指定の
// tagIds / checklist / reminders が既定値で上書きされてしまう。
const ClassFields = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(7),
  startTime: HHmm,
  endTime: HHmm,
  courseName: z.string().min(1).max(120),
  classroom: z.string().max(60).optional(),
  teacher: z.string().max(60).optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  tagIds: z.array(zId).max(MAX_TAG_IDS),
  checklist: z.array(
    z.object({
      label: z.string().min(1).max(120),
      orderIdx: zOrderIdx.default(0),
    }),
  ).max(MAX_CHECKLIST_ITEMS),
  reminders: z.array(
    z.object({
      offsetMin: zOffsetMin,
      channel: z.enum(["SLACK", "PUSH"]),
    }),
  ).max(MAX_REMINDERS),
});

export const ClassCreateInput = ClassFields.extend({
  tagIds: ClassFields.shape.tagIds.default([]),
  checklist: ClassFields.shape.checklist.default([]),
  reminders: ClassFields.shape.reminders.default([
    { offsetMin: -60, channel: "PUSH" },
    { offsetMin: -15, channel: "PUSH" },
  ]),
});
export type ClassCreateInput = z.infer<typeof ClassCreateInput>;

export const ClassUpdateInput = ClassFields.partial();
export type ClassUpdateInput = z.infer<typeof ClassUpdateInput>;
