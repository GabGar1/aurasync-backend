import { z } from "zod";

export const LowStockItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  sku: z.string().nullable(),
  stock: z.coerce.number().int(),
});

export const NoSalesItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  stock: z.coerce.number().int(),
});

export const TurnoverItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  sales_qty_30d: z.coerce.number().int(),
  avg_stock: z.coerce.number(),
  turnover: z.coerce.number(),
});

export const StockValueByCategory = z.object({
  category: z.string().nullable(),
  total_value: z.coerce.number(),
  variant_count: z.coerce.number().int(),
});

export const DeadStockItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  stock: z.coerce.number().int(),
  days_without_sale: z.coerce.number().int(),
});

export const DashboardStockResponse = z.object({
  low_stock: z.array(LowStockItem),
  no_sales_30d: z.array(NoSalesItem),
  turnover_rate: z.array(TurnoverItem),
  stock_value_by_category: z.array(StockValueByCategory),
  dead_stock: z.array(DeadStockItem),
});

export const StorefrontStats = z.object({
  storefront: z.string().nullable(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
});

export const ProvinceStats = z.object({
  province: z.string().nullable(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
});

export const CampaignStats = z.object({
  campaign: z.string().nullable(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
  aov: z.coerce.number(),
});

export const SourceStats = z.object({
  source: z.string().nullable(),
  medium: z.string().nullable(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
});

export const PaymentMethodStats = z.object({
  method: z.string().nullable(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
});

export const DashboardMarketingResponse = z.object({
  by_storefront: z.array(StorefrontStats),
  by_province: z.array(ProvinceStats),
  by_campaign: z.array(CampaignStats),
  by_source: z.array(SourceStats),
  by_payment_method: z.array(PaymentMethodStats),
});

export const HourStats = z.object({
  hour: z.coerce.number().int(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
});

export const TopProductItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  total_sold: z.coerce.number().int(),
  revenue: z.coerce.number(),
});

export const RevenueTrendItem = z.object({
  date: z.string(),
  revenue: z.coerce.number(),
  orders: z.coerce.number().int(),
});

export const OrderStatusStats = z.object({
  status: z.string(),
  count: z.coerce.number().int(),
});

export const RepeatCustomers = z.object({
  unique_customers: z.number().int(),
  repeat_customers: z.number().int(),
  repeat_rate: z.number(),
});

export const DashboardOrdersResponse = z.object({
  by_hour: z.array(HourStats),
  top_products: z.array(TopProductItem),
  average_order_value: z.coerce.number(),
  revenue_trend: z.array(RevenueTrendItem),
  by_status: z.array(OrderStatusStats),
  repeat_customers: RepeatCustomers,
});
