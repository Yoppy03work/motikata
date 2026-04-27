import { z } from "zod";

export const TagCreateInput = z.object({
  name: z.string().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export type TagCreateInput = z.infer<typeof TagCreateInput>;

export const TagUpdateInput = TagCreateInput.partial();
