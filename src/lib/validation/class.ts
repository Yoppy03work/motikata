import { z } from "zod";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm 形式で入力してください");

export const ClassCreateInput = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(7),
  startTime: HHmm,
  endTime: HHmm,
  courseName: z.string().min(1).max(120),
  classroom: z.string().max(60).optional(),
  teacher: z.string().max(60).optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  tagIds: z.array(z.number().int()).default([]),
  checklist: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        orderIdx: z.number().int().min(0).default(0),
      }),
    )
    .default([]),
  reminders: z
    .array(
      z.object({
        offsetMin: z.number().int(),
        channel: z.enum(["SLACK", "PUSH"]),
      }),
    )
    .default([
      { offsetMin: -60, channel: "PUSH" },
      { offsetMin: -15, channel: "PUSH" },
    ]),
});
export type ClassCreateInput = z.infer<typeof ClassCreateInput>;

export const ClassUpdateInput = ClassCreateInput.partial();
export type ClassUpdateInput = z.infer<typeof ClassUpdateInput>;
