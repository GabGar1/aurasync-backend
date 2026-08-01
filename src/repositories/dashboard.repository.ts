import { db } from "../lib/db.js";

function validOrderFilter(query: any) {
  return query.whereNull('orders.deleted_at').where('orders.status', '<>', 'CANCELED');
}

export class DashboardRepository {
  private dateWindow(days: number, dates: { start?: Date; end?: Date } = {}) {
    const end = dates.end ?? new Date();
    const start = dates.start ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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

  async getNoSales30d(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return db("product_variants")
      .join("products", "products.id", "product_variants.product_id")
      .where("product_variants.stock_quantity", ">", 0)
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .whereNotIn("product_variants.id", function (this: any) {
        this.select("order_items.variant_id")
          .from("order_items")
          .join("orders", "orders.id", "order_items.order_id")
          .where("orders.created_at", ">=", cutoff)
          .andWhere("orders.status", "<>", "CANCELED")
          .whereNull("orders.deleted_at");
      })
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        "product_variants.stock_quantity as stock"
      );
  }

  async getTurnoverRate(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const salesSubquery = db("order_items")
      .join("orders", "orders.id", "order_items.order_id")
      .where("orders.created_at", ">=", cutoff)
      .andWhere("orders.status", "<>", "CANCELED")
      .whereNull("orders.deleted_at")
      .groupBy("order_items.variant_id")
      .select(
        "order_items.variant_id",
        db.raw("SUM(order_items.quantity)::int as sales_qty")
      )
      .as("sales");

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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return db("product_variants")
      .join("products", "products.id", "product_variants.product_id")
      .where("product_variants.stock_quantity", ">", 0)
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .whereNotIn("product_variants.id", function (this: any) {
        this.select("order_items.variant_id")
          .from("order_items")
          .join("orders", "orders.id", "order_items.order_id")
          .where("orders.created_at", ">=", cutoff)
          .andWhere("orders.status", "<>", "CANCELED")
          .whereNull("orders.deleted_at");
      })
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        "product_variants.stock_quantity as stock",
        db.raw(
          "EXTRACT(DAY FROM NOW() - product_variants.updated_at)::int as days_without_sale"
        )
      )
      .orderBy("days_without_sale", "desc");
  }

  async getMarketingStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
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

    const byCampaign = await baseQuery
      .clone()
      .groupBy("utm_campaign")
      .select(
        "utm_campaign as campaign",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue"),
        db.raw("COALESCE(ROUND(AVG(total_amount)::decimal, 2), 0)::float8 as aov")
      )
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

  async getOrdersStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
    const { start, end } = this.dateWindow(days, dates);

    const baseQuery = validOrderFilter(
      db("orders")
        .where("orders.created_at", ">=", start)
        .andWhere("orders.created_at", "<=", end)
    );

    const byHour = await baseQuery
      .clone()
      .groupBy(db.raw("EXTRACT(HOUR FROM orders.created_at)::int"))
      .select(
        db.raw("EXTRACT(HOUR FROM orders.created_at)::int as hour"),
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue")
      )
      .orderBy("hour");

    const topProducts = await db("order_items")
      .join("product_variants", "product_variants.id", "order_items.variant_id")
      .join("products", "products.id", "product_variants.product_id")
      .join("orders", "orders.id", "order_items.order_id")
      .where("orders.created_at", ">=", start)
      .andWhere("orders.created_at", "<=", end)
      .where("orders.status", "<>", "CANCELED")
      .whereNull("orders.deleted_at")
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .groupBy("products.id", "products.name", "product_variants.name")
      .select(
        "products.id as product_id",
        "products.name as product_name",
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
      .groupBy(db.raw("DATE(orders.created_at)"))
      .select(
        db.raw("DATE(orders.created_at)::text as date"),
        db.raw("COALESCE(SUM(total_amount), 0)::float8 as revenue"),
        db.raw("COUNT(*)::int as orders")
      )
      .orderBy("date", "desc")
      .limit(30);

    const byStatus = await baseQuery
      .clone()
      .groupBy("status")
      .select("status", db.raw("COUNT(*)::int as count"))
      .orderBy("count", "desc");

    const customerStats = await baseQuery
      .clone()
      .select(
        db.raw("COUNT(DISTINCT customer_email)::int as unique_customers")
      )
      .first();

    const repeatRow = await db("orders")
      .where("orders.created_at", ">=", start)
      .andWhere("orders.created_at", "<=", end)
      .where("orders.status", "<>", "CANCELED")
      .whereNull("orders.deleted_at")
      .whereNotNull("customer_email")
      .groupBy("customer_email")
      .havingRaw("COUNT(*) > 1")
      .select(db.raw("COUNT(*)::int as repeat_customers"))
      .first();

    const unique = customerStats?.unique_customers ?? 0;
    const repeat = repeatRow?.repeat_customers ?? 0;

    return {
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
