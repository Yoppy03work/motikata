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
  // Phase 4: 指定すると、ローカル作成と同時に Google カレンダーにも push し、
  // sourceExternalId に Google event id を入れて source=GOOGLE で保存する。
  // 未指定なら従来通り source=MANUAL の純ローカルタスク。
  googleCalendarId: z.number().int().optional(),
  // Phase 14b: 終了時刻 (multi-day 対応 + duration 保持)。未指定なら 1h fallback。
  endAt: z.string().datetime({ offset: true }).optional(),
  // Phase 14b: 終日 event 判定。true なら時刻部分は無視され、当日 00:00 から
  // 翌日 00:00 (default) または指定 endAt まで all-day で作成される。
  isAllDay: z.boolean().default(false),
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
