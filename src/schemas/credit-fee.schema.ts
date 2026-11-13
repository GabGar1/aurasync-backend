import { z } from "zod";

export const CreditFeeSchema = {
  create: z.object({
    installments: z.number().int().min(1).max(24),
    percent: z.number().min(0).max(100),
    fixed_fee: z.number().min(0).default(0),
  }),

  update: z.object({
    percent: z.number().min(0).optional(),
    fixed_fee: z.number().min(0).optional(),
    is_active: z.boolean().optional(),
  }),
};

export type CreditFeeCreate = z.input<typeof CreditFeeSchema.create>;
export type CreditFeeUpdate = z.input<typeof CreditFeeSchema.update>;
