import { z } from "zod";
import { AcademicKind } from "./enums";

export const AcademicImportInput = z.object({
  format: z.enum(["csv", "ics"]),
  content: z.string().min(1),
});
export type AcademicImportInput = z.infer<typeof AcademicImportInput>;

export const AcademicEventInput = z.object({
  title: z.string().min(1).max(120),
  date: z.string().date(),
  kind: AcademicKind,
});
