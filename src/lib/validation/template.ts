import { z } from "zod";
import { TaskPriority } from "./enums";

const ChecklistTemplateInput = z.object({
  label: z.string().min(1).max(120),
  orderIdx: z.number().int().min(0).default(0),
});

export const TemplateCreateInput = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  priority: TaskPriority.default("MID"),
  rrule: z.string().min(3),
  defaultDueOffsetMin: z.number().int().default(0),
  tagIds: z.array(z.number().int()).default([]),
  checklist: z.array(ChecklistTemplateInput).default([]),
  reminders: z
    .array(
      z.object({
        offsetMin: z.number().int(),
        channel: z.enum(["SLACK", "PUSH"]),
      }),
    )
    .default([]),
});
export type TemplateCreateInput = z.infer<typeof TemplateCreateInput>;

export const TemplateUpdateInput = TemplateCreateInput.partial();
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateInput>;
