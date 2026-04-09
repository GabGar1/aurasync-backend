import { z } from 'zod';

const OrderItemBaseSchema = z.object({
  id: z.uuid(),
  order_id: z.uuid(),
  variant_id: z.uuid(),
  quantity: z.number().int().positive('Quantity must be greater than zero'),

  unit_price: z.number().min(0),
  unit_cost: z.number().min(0).default(0),
  unit_packaging_cost: z.number().min(0).default(0),
  unit_platform_fee: z.number().min(0).default(0),

  status: z.boolean().default(true),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});


const OrderItemCreateSchema = z.object({
  variant_id: z.uuid('Invalid variant ID'),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  unit_price: z.number().min(0, 'Unit price cannot be negative'),
  unit_cost: z.number().min(0).optional(),
  unit_packaging_cost: z.number().min(0).optional(),
  unit_platform_fee: z.number().min(0).optional(),
});


const OrderStatusEnum = z.enum(['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELED']);

export const OrderSchema = {
  base: z.object({
    id: z.uuid(),
    nuvemshop_order_id: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
    status: OrderStatusEnum.default('PENDING'),
    total_amount: z.number().min(0).default(0),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
  }),

  create: z.object({
    nuvemshop_order_id: z.string().optional(),
    customer_name: z.string().optional(),
    status: OrderStatusEnum.optional(),
    total_amount: z.number().min(0).optional(),
    items: z.array(OrderItemCreateSchema).min(1, 'Order must have at least one item'),
  }),

  update: z.object({
    customer_name: z.string().optional(),
    status: OrderStatusEnum.optional(),
  }),

  response: z.object({
    id: z.uuid(),
    nuvemshop_order_id: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
    status: z.string(),
    total_amount: z.number(),
    created_at: z.date(),
    updated_at: z.date(),
    items: z.array(OrderItemBaseSchema),
  }),

  listResponse: z.object({
    orders: z.array(z.object({
      id: z.uuid(),
      nuvemshop_order_id: z.string().nullable().optional(),
      customer_name: z.string().nullable().optional(),
      status: z.string(),
      total_amount: z.number(),
      created_at: z.date(),
      updated_at: z.date(),
      items: z.array(OrderItemBaseSchema),
    })),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
};

// Type exports for TypeScript inference
export type Order = z.infer<typeof OrderSchema.base>;
export type OrderCreate = z.infer<typeof OrderSchema.create>;
export type OrderUpdate = z.infer<typeof OrderSchema.update>;
export type OrderResponse = z.infer<typeof OrderSchema.response>;
export type OrderListResponse = z.infer<typeof OrderSchema.listResponse>;

export type OrderItem = z.infer<typeof OrderItemBaseSchema>;
export type OrderItemCreate = z.infer<typeof OrderItemCreateSchema>;