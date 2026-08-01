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
  unit_tax: z.number().min(0).default(0),
  unit_shipping_cost: z.number().min(0).default(0),
  unit_operational_cost: z.number().min(0).default(0),
  unit_marketing_cost: z.number().min(0).default(0),
  unit_other_cost: z.number().min(0).default(0),
  unit_total_cost: z.number().min(0).default(0),
  unit_profit: z.number().default(0),
  margin_percent: z.number().default(0),
  cost_breakdown: z.array(z.object({
    component_id: z.string().nullable(),
    name: z.string(),
    type: z.string(),
    category: z.string(),
    unit_value: z.number(),
    quantity: z.number(),
    line_total: z.number(),
  })).nullable().optional(),
  has_promotional_price: z.boolean().nullable().optional(),

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


const OrderStatusEnum = z.enum(['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELED', 'open', 'closed', 'cancelled', 'paid', 'shipped']);

const OrderResponseShapeSchema = z.object({
  id: z.uuid(),
  nuvemshop_order_id: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  status: z.string(),
  total_amount: z.number(),
  source: z.string().optional(),
  total_cost: z.number().optional(),
  total_profit: z.number().optional(),
  margin_percent: z.number().optional(),
  status_label: z.string().optional(),
  payment_status_label: z.string().optional(),
  fulfillment_status_label: z.string().optional(),
  commercial_status: z.string().optional(),
  discount_amount: z.number().nullable().optional(),
  shipping_cost_customer: z.number().nullable().optional(),
  shipping_cost_owner: z.number().nullable().optional(),
  payment_status: z.string().nullable().optional(),
  fulfillment_status: z.string().nullable().optional(),
  has_free_shipping: z.boolean().nullable().optional(),
  paid_at: z.date().nullable().optional(),
  shipped_at: z.date().nullable().optional(),
  completed_at: z.date().nullable().optional(),
  cancelled_at: z.date().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  payment_installments: z.number().int().nullable().optional(),
  gateway: z.string().nullable().optional(),
  shipping_city: z.string().nullable().optional(),
  shipping_province: z.string().nullable().optional(),
  shipping_carrier: z.string().nullable().optional(),
  utm_source: z.string().nullable().optional(),
  utm_medium: z.string().nullable().optional(),
  utm_campaign: z.string().nullable().optional(),
  utm_content: z.string().nullable().optional(),
  utm_term: z.string().nullable().optional(),
  storefront: z.string().nullable().optional(),
  customer_email: z.string().nullable().optional(),
  created_at: z.date(),
  updated_at: z.date(),
  items: z.array(OrderItemBaseSchema),
});

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

  response: OrderResponseShapeSchema,

  listResponse: z.object({
    orders: z.array(OrderResponseShapeSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
};

export type Order = z.infer<typeof OrderSchema.base>;
export type OrderCreate = z.infer<typeof OrderSchema.create>;
export type OrderUpdate = z.infer<typeof OrderSchema.update>;
export type OrderResponse = z.infer<typeof OrderSchema.response>;
export type OrderListResponse = z.infer<typeof OrderSchema.listResponse>;

export type OrderItem = z.infer<typeof OrderItemBaseSchema>;
export type OrderItemCreate = z.infer<typeof OrderItemCreateSchema>;