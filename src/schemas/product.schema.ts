import { z } from 'zod';

const VariantBaseSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  nuvemshop_variant_id: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  price: z.number().min(0, 'Price cannot be negative'),
  stock_quantity: z.number().int().min(0, 'Stock cannot be negative'),
  cost_price: z.number().min(0).default(0),
  packaging_cost: z.number().min(0).default(0),
  platform_fee_percent: z.number().min(0).default(0),
  fixed_fee: z.number().min(0).default(0),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

const VariantCreateSchema = z.object({
  nuvemshop_variant_id: z.string().optional(),
  sku: z.string().optional(),
  name: z.string().optional(),
  price: z.number().min(0, 'Price is required and cannot be negative'),
  stock_quantity: z.number().int().min(0, 'Stock quantity is required'),
  cost_price: z.number().min(0).optional(),
  packaging_cost: z.number().min(0).optional(),
  platform_fee_percent: z.number().min(0).optional(),
  fixed_fee: z.number().min(0).optional(),
});


export const ProductSchema = {
  base: z.object({
    id: z.uuid(),
    nuvemshop_id: z.string().nullable().optional(),
    slug: z.string().min(1, 'Slug is required'),
    name: z.string().min(1, 'Name is required'),
    category: z.string().nullable().optional(),
    is_active: z.boolean().default(true),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
  }),

  create: z.object({
    nuvemshop_id: z.string().optional(),
    slug: z.string().min(1, 'Slug is required').max(100, 'Slug cannot exceed 100 characters'),
    name: z.string().min(1, 'Name is required').max(150, 'Name cannot exceed 150 characters'),
    category: z.string().optional(),
    is_active: z.boolean().optional(),
    variants: z.array(VariantCreateSchema).min(1, 'Product must have at least one variant'),
  }),

  update: z.object({
    slug: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(150).optional(),
    category: z.string().optional(),
    is_active: z.boolean().optional(),
  }),

  response: z.object({
    id: z.uuid(),
    nuvemshop_id: z.string().nullable().optional(),
    slug: z.string(),
    name: z.string(),
    category: z.string().nullable().optional(),
    is_active: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
    variants: z.array(VariantBaseSchema),
  }),

  listResponse: z.object({
    products: z.array(z.object({
      id: z.uuid(),
      nuvemshop_id: z.string().nullable().optional(),
      slug: z.string(),
      name: z.string(),
      category: z.string().nullable().optional(),
      is_active: z.boolean(),
      created_at: z.date(),
      updated_at: z.date(),
      variants: z.array(VariantBaseSchema),
    })),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
};

export type Product = z.infer<typeof ProductSchema.base>;
export type ProductCreate = z.infer<typeof ProductSchema.create>;
export type ProductUpdate = z.infer<typeof ProductSchema.update>;
export type ProductResponse = z.infer<typeof ProductSchema.response>;
export type ProductListResponse = z.infer<typeof ProductSchema.listResponse>;

export type Variant = z.infer<typeof VariantBaseSchema>;
export type VariantCreate = z.infer<typeof VariantCreateSchema>;