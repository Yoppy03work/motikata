import { z } from "zod";

export const PinLoginInput = z.object({
  pin: z.string().regex(/^\d{4,8}$/, "4〜8桁の数字"),
});
export type PinLoginInput = z.infer<typeof PinLoginInput>;

export const PinChangeInput = z.object({
  currentPin: z.string().regex(/^\d{4,8}$/),
  newPin: z.string().regex(/^\d{4,8}$/),
});
