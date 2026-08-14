import { z } from "zod";

export const ProductSubgroupSchema = {
  base: z.object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    is_active: z.boolean().default(true),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
  }),

  create: z.object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().max(500).optional(),
    is_active: z.boolean().optional(),
  }),

  update: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    is_active: z.boolean().optional(),
  }),

  assignProducts: z.object({
    product_ids: z.array(z.uuid()).min(1, "product_ids is required"),
  }),

  response: z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable().optional(),
    is_active: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
  }),
};

export type ProductSubgroupCreate = z.input<typeof ProductSubgroupSchema.create>;
export type ProductSubgroupUpdate = z.input<typeof ProductSubgroupSchema.update>;
