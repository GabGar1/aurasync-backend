import { z } from "zod";

export const ExternalSaleItemSchema = z.object({
  variant_id: z.uuid("Invalid variant ID"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unit_price: z.number().min(0, "Unit price cannot be negative"),
});

export const ExternalSaleSchema = {
  create: z.object({
    customer_name: z.string().min(1, "Customer name is required").max(255),
    customer_email: z.string().email().nullable().optional(),
    items: z.array(ExternalSaleItemSchema).min(1, "Sale must have at least one item"),
    discount_amount: z.number().min(0).optional(),
    payment_method: z.string().max(50).optional(),
    gateway: z.string().max(100).optional(),
    payment_installments: z.number().int().positive().optional(),
    shipping_cost_owner: z.number().min(0).optional(),
    shipping_cost_customer: z.number().min(0).optional(),
    status: z.enum(["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELED"]).default("PAID"),
  }),

  response: z.object({
    id: z.uuid(),
    nuvemshop_order_id: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
    status: z.string(),
    total_amount: z.number(),
    source: z.string().optional(),
    discount_amount: z.number().nullable().optional(),
    shipping_cost_customer: z.number().nullable().optional(),
    shipping_cost_owner: z.number().nullable().optional(),
    payment_method: z.string().nullable().optional(),
    gateway: z.string().nullable().optional(),
    payment_installments: z.number().int().nullable().optional(),
    total_cost: z.number().optional(),
    total_profit: z.number().optional(),
    margin_percent: z.number().optional(),
    created_at: z.date(),
    updated_at: z.date(),
    items: z.array(z.object({
      id: z.uuid(),
      order_id: z.uuid(),
      variant_id: z.uuid(),
      quantity: z.number().int(),
      unit_price: z.number(),
      unit_cost: z.number(),
      unit_packaging_cost: z.number(),
      unit_platform_fee: z.number(),
      unit_tax: z.number(),
      unit_shipping_cost: z.number(),
      unit_operational_cost: z.number(),
      unit_marketing_cost: z.number(),
      unit_other_cost: z.number(),
      unit_total_cost: z.number(),
      unit_profit: z.number(),
      margin_percent: z.number(),
      cost_breakdown: z.array(z.object({
        component_id: z.string().nullable(),
        name: z.string(),
        type: z.string(),
        category: z.string(),
        unit_value: z.number(),
        quantity: z.number(),
        line_total: z.number(),
      })).nullable(),
      status: z.boolean(),
    })),
  }),
};

export type ExternalSaleCreate = z.input<typeof ExternalSaleSchema.create>;
export type ExternalSaleResponse = z.infer<typeof ExternalSaleSchema.response>;
