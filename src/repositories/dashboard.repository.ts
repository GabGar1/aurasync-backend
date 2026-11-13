import { db } from "../lib/db.js";
import { BadRequestError } from '../lib/errors.js';
import { localDateToUtc } from '../lib/store-time.js';

const NEGATIVE_STATUSES = ["CANCELED", "cancelled"];
const NEGATIVE_PAYMENT_STATUSES = ["voided", "refunded", "cancelled"];
const NEGATIVE_FULFILLMENT_STATUSES = ["cancelled", "CANCELED"];

function validOrderFilter(query: any) {
  return query
    .whereNull('orders.deleted_at')
    .whereNotIn('orders.status', NEGATIVE_STATUSES)
    .where(function (this: any) {
      this.whereNull('orders.payment_status').orWhereNotIn('orders.payment_status', NEGATIVE_PAYMENT_STATUSES);
    })
    .where(function (this: any) {
      this.whereNull('orders.fulfillment_status').orWhereNotIn('orders.fulfillment_status', NEGATIVE_FULFILLMENT_STATUSES);
    });
}

export class DashboardRepository {
  private dateWindow(days: number, dates: { start_date?: string; end_date?: string } = {}) {
    if (dates.start_date || dates.end_date) {
      const startDate = dates.start_date ?? dates.end_date!;
      const endDate = dates.end_date ?? dates.start_date!;
      const start = localDateToUtc(startDate);
      const end = localDateToUtc(endDate, true);
      if (end < start) {
        throw new BadRequestError("end_date cannot be before start_date");
      }
      return { start, end };
    }
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  async getLowStock(threshold = 5) {
    return db("product_variants")
      .join("products", "products.id", "product_variants.product_id")
      .where("product_variants.stock_quantity", "<=", threshold)
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        "product_variants.sku",
        "product_variants.stock_quantity as stock"
      )
      .orderBy("product_variants.stock_quantity", "asc");
  }

  /**
   * Variants with stock and no valid sale in the last `days`, with how long since their
   * last sale (or since they were created, if they never sold). One query serves both
   * "sem vendas" and "estoque parado".
   */
  private variantsWithoutSales(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const salesOfVariant = () =>
      validOrderFilter(
        db("order_items")
          .join("orders", "orders.id", "order_items.order_id")
          .whereRaw("order_items.variant_id = product_variants.id")
          .where("order_items.status", true)
      );

    // NOT EXISTS (not NOT IN): a NULL variant_id in order_items would make NOT IN match nothing.
    return db("product_variants")
      .join("products", "products.id", "product_variants.product_id")
      .where("product_variants.stock_quantity", ">", 0)
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .whereNotExists(salesOfVariant().where("orders.created_at", ">=", cutoff).select(db.raw("1")))
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        "product_variants.stock_quantity as stock",
        // Last sale, not product_variants.updated_at (which changes on every Nuvemshop sync).
        db.raw(
          "EXTRACT(DAY FROM NOW() - COALESCE((?), product_variants.created_at))::int as days_without_sale",
          [salesOfVariant().max("orders.created_at")]
        )
      )
      .orderBy("days_without_sale", "desc");
  }

  async getNoSales30d(days: number) {
    return this.variantsWithoutSales(days);
  }

  async getTurnoverRate(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const salesSubquery = validOrderFilter(
      db("order_items")
        .join("orders", "orders.id", "order_items.order_id")
        .where("orders.created_at", ">=", cutoff)
        .groupBy("order_items.variant_id")
        .select(
          "order_items.variant_id",
          db.raw("SUM(order_items.quantity)::int as sales_qty")
        )
    ).as("sales");

    return db("product_variants")
      .join("products", "products.id", "product_variants.product_id")
      .join(salesSubquery, "sales.variant_id", "product_variants.id")
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .where("product_variants.stock_quantity", ">", 0)
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        "sales.sales_qty as sales_qty_30d",
        "product_variants.stock_quantity as avg_stock",
        db.raw(
          "ROUND((sales.sales_qty::decimal / GREATEST(product_variants.stock_quantity, 1))::decimal, 2)::float8 as turnover"
        )
      )
      .orderBy("turnover", "desc");
  }

  async getStockValueByCategory() {
    return db("product_variants")
      .join("products", "products.id", "product_variants.product_id")
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .groupBy("products.category")
      .select(
        "products.category",
        db.raw(
          "COALESCE(SUM(product_variants.stock_quantity * product_variants.cost_price), 0)::float8 as total_value"
        ),
        db.raw("COUNT(product_variants.id)::int as variant_count")
      )
      .orderBy("total_value", "desc");
  }

  async getDeadStock(days: number) {
    return this.variantsWithoutSales(days);
  }

  async getMarketingStats(days = 30, dates: { start_date?: string; end_date?: string } = {}) {
    const { start, end } = this.dateWindow(days, dates);

    const baseQuery = validOrderFilter(
      db("orders")
        .where("orders.created_at", ">=", start)
        .andWhere("orders.created_at", "<=", end)
    );

    const byStorefront = await baseQuery
      .clone()
      .groupBy("storefront")
      .select(
        "storefront",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue")
      )
      .orderBy("orders", "desc");

    const byProvince = await baseQuery
      .clone()
      .groupBy("shipping_province")
      .select(
        "shipping_province as province",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue")
      )
      .orderBy("orders", "desc");

    const campaignSubquery = baseQuery
      .clone()
      .select(
        db.raw(`CASE WHEN orders.utm_campaign IS NOT NULL THEN orders.utm_campaign ELSE NULL END as campaign`),
        db.raw(`CASE WHEN orders.utm_campaign IS NULL THEN orders.utm_source ELSE NULL END as source`),
        db.raw(`CASE WHEN orders.utm_campaign IS NULL THEN orders.utm_medium ELSE NULL END as medium`),
        "orders.total_amount as total_amount"
      )
      .as("campaign_orders");

    const byCampaign = await db(campaignSubquery)
      .select(
        "campaign_orders.campaign as campaign",
        "campaign_orders.source as source",
        "campaign_orders.medium as medium",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(campaign_orders.total_amount), 0)::float8 as revenue"),
        db.raw("COALESCE(ROUND(AVG(campaign_orders.total_amount)::decimal, 2), 0)::float8 as aov")
      )
      .groupBy("campaign_orders.campaign", "campaign_orders.source", "campaign_orders.medium")
      .orderBy("orders", "desc");

    const bySource = await baseQuery
      .clone()
      .groupBy("utm_source", "utm_medium")
      .select(
        "utm_source as source",
        "utm_medium as medium",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue")
      )
      .orderBy("orders", "desc");

    const byPaymentMethod = await baseQuery
      .clone()
      .groupBy("payment_method")
      .select(
        "payment_method as method",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue")
      )
      .orderBy("orders", "desc");

    return {
      by_storefront: byStorefront,
      by_province: byProvince,
      by_campaign: byCampaign,
      by_source: bySource,
      by_payment_method: byPaymentMethod,
    };
  }

  /** Revenue, orders, ticket and profit of valid orders in [start, end]. */
  private async periodSummary(start: Date, end: Date) {
    const row = (await validOrderFilter(
      db("orders").where("orders.created_at", ">=", start).andWhere("orders.created_at", "<=", end)
    )
      .select(
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue"),
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_profit), 0)::float8 as profit"),
        db.raw("COALESCE(SUM(total_amount - COALESCE(discount_amount, 0)), 0)::float8 as net_revenue")
      )
      .first()) as { revenue: number; orders: number; profit: number; net_revenue: number } | undefined;

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const revenue = Number(row?.revenue ?? 0);
    const orders = Number(row?.orders ?? 0);
    const profit = Number(row?.profit ?? 0);
    const netRevenue = Number(row?.net_revenue ?? 0);
    return {
      revenue: round2(revenue),
      orders,
      average_order_value: orders > 0 ? round2(revenue / orders) : 0,
      profit: round2(profit),
      margin_percent: netRevenue > 0 ? round2((profit / netRevenue) * 100) : 0,
    };
  }

  async getOrdersStats(days = 30, dates: { start_date?: string; end_date?: string } = {}) {
    const { start, end } = this.dateWindow(days, dates);
    // The window of the same length right before the selected one, for the deltas.
    const length = end.getTime() - start.getTime();
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(start.getTime() - length - 1);
    const [summary, previousSummary] = await Promise.all([
      this.periodSummary(start, end),
      this.periodSummary(previousStart, previousEnd),
    ]);

    const baseQuery = validOrderFilter(
      db("orders")
        .where("orders.created_at", ">=", start)
        .andWhere("orders.created_at", "<=", end)
    );

    const localHourExpr =
      "EXTRACT(HOUR FROM (orders.created_at AT TIME ZONE 'America/Sao_Paulo'))::int";

    const byHour = await baseQuery
      .clone()
      .groupBy(db.raw(localHourExpr))
      .select(
        db.raw(`${localHourExpr} as hour`),
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue")
      )
      .orderBy("hour");

    const topProducts = await validOrderFilter(
      db("order_items")
        .join("product_variants", "product_variants.id", "order_items.variant_id")
        .join("products", "products.id", "product_variants.product_id")
        .join("orders", "orders.id", "order_items.order_id")
        .where("orders.created_at", ">=", start)
        .andWhere("orders.created_at", "<=", end)
        .whereNull("product_variants.deleted_at")
        .whereNull("products.deleted_at")
    )
      .groupBy("products.id", "products.name", "products.category", "product_variants.name")
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "products.category",
        "product_variants.name as variant_name",
        db.raw("SUM(order_items.quantity)::int as total_sold"),
        db.raw(
          "COALESCE(SUM(order_items.quantity * order_items.unit_price), 0)::float8 as revenue"
        )
      )
      .orderBy("total_sold", "desc")
      .limit(20);

    const aovRow = await baseQuery
      .clone()
      .select(
        db.raw("COALESCE(ROUND(AVG(total_amount)::decimal, 2), 0)::float8 as aov")
      )
      .first();

    const revenueTrend = await baseQuery
      .clone()
      .groupBy(db.raw("(orders.created_at AT TIME ZONE 'America/Sao_Paulo')::date"))
      .select(
        db.raw("(orders.created_at AT TIME ZONE 'America/Sao_Paulo')::date::text as date"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue"),
        db.raw("COUNT(*)::int as orders")
      )
      .orderBy("date", "asc")
      .limit(366);

    const byStatus = await baseQuery
      .clone()
      .groupBy(db.raw("COALESCE(orders.fulfillment_status, 'PENDING')"))
      .select(
        db.raw("COALESCE(orders.fulfillment_status, 'PENDING') as status"),
        db.raw("COUNT(*)::int as count")
      )
      .orderBy("count", "desc");

    const customerStats = await baseQuery
      .clone()
      .select(
        db.raw("COUNT(DISTINCT customer_email)::int as unique_customers")
      )
      .first();

    // Count the customers with more than one order (not the orders of the first such customer).
    const repeatCustomers = validOrderFilter(
      db("orders")
        .where("orders.created_at", ">=", start)
        .andWhere("orders.created_at", "<=", end)
        .whereNotNull("customer_email")
        .groupBy("customer_email")
        .havingRaw("COUNT(*) > 1")
        .select("customer_email")
    ).as("repeaters");
    const repeatRow = (await db.from(repeatCustomers).select(db.raw("COUNT(*)::int as repeat_customers")).first()) as
      | { repeat_customers: number }
      | undefined;

    const unique = customerStats?.unique_customers ?? 0;
    const repeat = repeatRow?.repeat_customers ?? 0;

    return {
      summary,
      previous_summary: previousSummary,
      by_hour: byHour,
      top_products: topProducts,
      average_order_value: aovRow?.aov ?? 0,
      revenue_trend: revenueTrend,
      by_status: byStatus,
      repeat_customers: {
        unique_customers: unique,
        repeat_customers: repeat,
        repeat_rate:
          unique > 0 ? Math.round((repeat / unique) * 100) / 100 : 0,
      },
    };
  }
}

export const dashboardRepository = new DashboardRepository();
