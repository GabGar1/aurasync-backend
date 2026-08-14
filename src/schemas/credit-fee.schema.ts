import { z } from "zod";

export const CreditFeeSchema = {
  update: z.object({
    percent: z.number().min(0).optional(),
    fixed_fee: z.number().min(0).optional(),
    is_active: z.boolean().optional(),
  }),
};

export type CreditFeeUpdate = z.input<typeof CreditFeeSchema.update>;
