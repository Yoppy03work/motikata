import { z } from "zod";

export const NoteKind = z.enum(["INBOX", "DIARY"]);
export type NoteKind = z.infer<typeof NoteKind>;

export const NoteCreateInput = z.object({
  body: z.string().min(1).max(4000),
  kind: NoteKind.default("INBOX"),
  diaryDate: z.string().date().optional(),
});
export type NoteCreateInput = z.infer<typeof NoteCreateInput>;

export const NoteUpdateInput = z.object({
  body: z.string().min(1).max(4000).optional(),
  archived: z.boolean().optional(),
  diaryDate: z.string().date().nullable().optional(),
});
export type NoteUpdateInput = z.infer<typeof NoteUpdateInput>;

export const NoteListQuery = z.object({
  tab: z.enum(["inbox", "diary", "stream"]).default("stream"),
  date: z.string().date().optional(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
