import { z } from "zod";
import { ItemType, TaskPriority, TaskStatus } from "./enums";

const ChecklistItemInput = z.object({
  label: z.string().min(1).max(120),
  orderIdx: z.number().int().min(0).default(0),
});

export const TaskCreateInput = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  dueAt: z.string().datetime({ offset: true }),
  itemType: ItemType.default("TASK"),
  required: z.boolean().default(true),
  priority: TaskPriority.default("MID"),
  tagIds: z.array(z.number().int()).default([]),
  checklist: z.array(ChecklistItemInput).default([]),
  reminders: z
    .array(
      z.object({
        offsetMin: z.number().int(),
        channel: z.enum(["SLACK", "PUSH"]),
      }),
    )
    .default([]),
});
export type TaskCreateInput = z.infer<typeof TaskCreateInput>;

export const TaskUpdateInput = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  itemType: ItemType.optional(),
  required: z.boolean().optional(),
  priority: TaskPriority.optional(),
  tagIds: z.array(z.number().int()).optional(),
});
export type TaskUpdateInput = z.infer<typeof TaskUpdateInput>;

export const TaskListQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  status: TaskStatus.optional(),
  tagId: z.coerce.number().int().optional(),
  priority: TaskPriority.optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuery>;

export const ChecklistItemCreate = ChecklistItemInput;
export const ChecklistItemUpdate = z.object({
  label: z.string().min(1).max(120).optional(),
  orderIdx: z.number().int().min(0).optional(),
  checked: z.boolean().optional(),
});
