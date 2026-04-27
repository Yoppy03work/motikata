import { z } from "zod";

export const TaskPriority = z.enum(["LOW", "MID", "HIGH"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TaskStatus = z.enum(["OPEN", "DONE", "SKIPPED"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskSource = z.enum(["MANUAL", "RECURRING", "CLASS", "ACADEMIC"]);
export type TaskSource = z.infer<typeof TaskSource>;

export const TemplateKind = z.enum(["MANUAL", "RECURRING", "CLASS"]);
export type TemplateKind = z.infer<typeof TemplateKind>;

export const ReminderChannel = z.enum(["SLACK", "PUSH"]);
export type ReminderChannel = z.infer<typeof ReminderChannel>;

export const AcademicKind = z.enum(["EXAM", "HOLIDAY", "EVENT"]);
export type AcademicKind = z.infer<typeof AcademicKind>;

export const ItemType = z.enum(["TASK", "EVENT"]);
export type ItemType = z.infer<typeof ItemType>;
