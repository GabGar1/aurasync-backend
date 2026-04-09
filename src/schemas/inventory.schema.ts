import { z } from 'zod';

const TransactionTypeEnum = z.enum(['SALE', 'RESTOCK', 'ADJUSTMENT']);

export const InventorySchema = {
  create: z.object({
    variant_id: z.uuid('Invalid variant ID'),
    order_id: z.uuid().optional().nullable(),
    type: TransactionTypeEnum,
    quantity_changed: z.number().int(),
  }),

  response: z.object({
    id: z.uuid(),
    variant_id: z.uuid(),
    order_id: z.string().nullable(),
    type: z.string(),
    quantity_changed: z.number(),
    status: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
  })
};

export type InventoryCreate = z.infer<typeof InventorySchema.create>;
export type InventoryResponse = z.infer<typeof InventorySchema.response>;