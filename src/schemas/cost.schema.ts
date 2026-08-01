import { z } from "zod";

export const CostComponentTypeEnum = z.enum(["FIXED", "PERCENT", "PER_ORDER", "MONTHLY"]);
export const CostComponentCategoryEnum = z.enum([
  "PACKAGING", "TAX", "FEE", "SHIPPING", "OPERATIONAL", "MARKETING", "OTHER",
]);
export const CalculationBaseEnum = z.enum(["PRICE", "COST"]);

const CostComponentBaseSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  type: CostComponentTypeEnum,
  category: CostComponentCategoryEnum.default("OTHER"),
  value: z.number().min(0, "Value cannot be negative"),
  calculation_base: CalculationBaseEnum.default("PRICE"),
  is_active: z.boolean().default(true),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});

const CostAssociationResponseSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  cost_component_id: z.uuid(),
  quantity: z.number().int(),
  component: CostComponentBaseSchema.optional(),
});

export const CostSchema = {
  base: CostComponentBaseSchema,

  create: z.object({
    name: z.string().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
    description: z.string().max(500).optional(),
    type: CostComponentTypeEnum,
    category: CostComponentCategoryEnum.optional(),
    value: z.number().min(0, "Value cannot be negative"),
    calculation_base: CalculationBaseEnum.optional(),
    is_active: z.boolean().optional(),
  }).superRefine((data, ctx) => {
    if (data.type === "PERCENT" && data.calculation_base === undefined) {
      ctx.addIssue({ code: "custom", path: ["calculation_base"], message: "calculation_base is required for PERCENT components" });
    }
  }),

  update: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    type: CostComponentTypeEnum.optional(),
    category: CostComponentCategoryEnum.optional(),
    value: z.number().min(0).optional(),
    calculation_base: CalculationBaseEnum.optional(),
    is_active: z.boolean().optional(),
  }),

  associate: z.object({
    product_id: z.uuid("Invalid product ID"),
    cost_component_id: z.uuid("Invalid component ID"),
    quantity: z.number().int().positive().default(1),
  }),

  associateResponse: CostAssociationResponseSchema,

  simulate: z.object({
    variant_id: z.uuid("Invalid variant ID"),
    unit_price: z.number().min(0, "Unit price cannot be negative"),
    quantity: z.number().int().positive(),
  }),

  simulateResponse: z.object({
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
    })),
  }),

  listAssociationsResponse: z.object({
    associations: z.array(CostAssociationResponseSchema),
  }),
};

export type CostComponent = z.infer<typeof CostSchema.base>;
export type CostComponentCreate = z.infer<typeof CostSchema.create>;
export type CostComponentUpdate = z.infer<typeof CostSchema.update>;
export type CostAssociationCreate = z.infer<typeof CostSchema.associate>;
export type CostAssociationResponse = z.infer<typeof CostSchema.associateResponse>;
export type CostSimulateInput = z.infer<typeof CostSchema.simulate>;
export type CostSimulateResponse = z.infer<typeof CostSchema.simulateResponse>;
