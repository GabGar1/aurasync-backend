# Dashboard KPIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose stock, marketing, and order KPIs via 3 REST API endpoints.

**Architecture:** New Router → Service → Repository files following existing 3-layer pattern. Queries are Knex aggregations computed on-the-fly. Only authenticated users can access (no admin restriction).

**Tech Stack:** Node + TypeScript, Fastify 5, Knex (pg), Zod

## Global Constraints

- Follow existing 3-layer pattern: Router → Service → Repository
- Any authenticated user can access dashboard endpoints (no role check)
- All queries filter `deleted_at IS NULL`
- Query params: `days` (number, default 30) for time-window filtering
- Zod response schemas for Swagger documentation
- Integration tests with real DB, `cleanupDatabase()` in `before`/`after`
- Tests clean up only their own data — never call `db("users").del()`

---

### Task 1: Dashboard Zod Schemas

**Files:**
- Create: `src/schemas/dashboard.schema.ts`
- Test: (no test — pure type definitions)

**Interfaces:**
- Consumes: nothing
- Produces: `DashboardStockResponse`, `DashboardMarketingResponse`, `DashboardOrdersResponse` — Zod schemas and inferred types

- [ ] **Step 1: Create the schema file**

```ts
import { z } from "zod";

export const LowStockItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  sku: z.string().nullable(),
  stock: z.number().int(),
});

export const NoSalesItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  stock: z.number().int(),
});

export const TurnoverItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  sales_qty_30d: z.number().int(),
  avg_stock: z.number(),
  turnover: z.number(),
});

export const StockValueByCategory = z.object({
  category: z.string().nullable(),
  total_value: z.number(),
  variant_count: z.number().int(),
});

export const DeadStockItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  stock: z.number().int(),
  days_without_sale: z.number().int(),
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
  orders: z.number().int(),
  revenue: z.number(),
});

export const ProvinceStats = z.object({
  province: z.string().nullable(),
  orders: z.number().int(),
  revenue: z.number(),
});

export const CampaignStats = z.object({
  campaign: z.string().nullable(),
  orders: z.number().int(),
  revenue: z.number(),
  aov: z.number(),
});

export const SourceStats = z.object({
  source: z.string().nullable(),
  medium: z.string().nullable(),
  orders: z.number().int(),
  revenue: z.number(),
});

export const PaymentMethodStats = z.object({
  method: z.string().nullable(),
  orders: z.number().int(),
  revenue: z.number(),
});

export const DashboardMarketingResponse = z.object({
  by_storefront: z.array(StorefrontStats),
  by_province: z.array(ProvinceStats),
  by_campaign: z.array(CampaignStats),
  by_source: z.array(SourceStats),
  by_payment_method: z.array(PaymentMethodStats),
});

export const HourStats = z.object({
  hour: z.number().int(),
  orders: z.number().int(),
  revenue: z.number(),
});

export const TopProductItem = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_name: z.string().nullable(),
  total_sold: z.number().int(),
  revenue: z.number(),
});

export const RevenueTrendItem = z.object({
  date: z.string(),
  revenue: z.number(),
  orders: z.number().int(),
});

export const OrderStatusStats = z.object({
  status: z.string(),
  count: z.number().int(),
});

export const RepeatCustomers = z.object({
  unique_customers: z.number().int(),
  repeat_customers: z.number().int(),
  repeat_rate: z.number(),
});

export const DashboardOrdersResponse = z.object({
  by_hour: z.array(HourStats),
  top_products: z.array(TopProductItem),
  average_order_value: z.number(),
  revenue_trend: z.array(RevenueTrendItem),
  by_status: z.array(OrderStatusStats),
  repeat_customers: RepeatCustomers,
});
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/dashboard.schema.ts
git commit -m "feat: add dashboard Zod schemas"
```

---

### Task 2: Dashboard Repository — Stock Queries

**Files:**
- Create: `src/repositories/dashboard.repository.ts`

**Interfaces:**
- Consumes: `db` from `src/lib/db.js`
- Produces: `getLowStock(threshold?)`, `getNoSales30d(days)`, `getTurnoverRate(days)`, `getStockValueByCategory()`, `getDeadStock(days)`

- [ ] **Step 1: Create the repository file with stock queries**

```ts
import { db } from "../lib/db.js";

export class DashboardRepository {
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
          "ROUND((sales.sales_qty::decimal / GREATEST(product_variants.stock_quantity, 1))::decimal, 2) as turnover"
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
          "COALESCE(SUM(product_variants.stock_quantity * product_variants.cost_price), 0) as total_value"
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
          .whereNull("orders.deleted_at");
      })
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        "product_variants.stock_quantity as stock",
        db.raw(`EXTRACT(DAY FROM NOW() - product_variants.updated_at)::int as days_without_sale`)
      )
      .orderBy("days_without_sale", "desc");
  }
}

export const dashboardRepository = new DashboardRepository();
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/dashboard.repository.ts
git commit -m "feat: add dashboard repository with stock queries"
```

---

### Task 3: Dashboard Repository — Marketing & Orders Queries

**Files:**
- Modify: `src/repositories/dashboard.repository.ts` (add methods)

**Interfaces:**
- Consumes: `db`
- Produces: `getMarketingStats(days)`, `getOrdersStats(days)`

- [ ] **Step 1: Add marketing query methods to DashboardRepository**

```ts
  async getMarketingStats(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const baseQuery = db("orders")
      .where("orders.created_at", ">=", cutoff)
      .whereNull("orders.deleted_at");

    const byStorefront = await baseQuery
      .clone()
      .groupBy("storefront")
      .select(
        "storefront",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue")
      )
      .orderBy("orders", "desc");

    const byProvince = await baseQuery
      .clone()
      .groupBy("shipping_province")
      .select(
        "shipping_province as province",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue")
      )
      .orderBy("orders", "desc");

    const byCampaign = await baseQuery
      .clone()
      .groupBy("utm_campaign")
      .select(
        "utm_campaign as campaign",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue"),
        db.raw("COALESCE(ROUND(AVG(total_amount)::decimal, 2), 0) as aov")
      )
      .orderBy("orders", "desc");

    const bySource = await baseQuery
      .clone()
      .groupBy("utm_source", "utm_medium")
      .select(
        "utm_source as source",
        "utm_medium as medium",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue")
      )
      .orderBy("orders", "desc");

    const byPaymentMethod = await baseQuery
      .clone()
      .groupBy("payment_method")
      .select(
        "payment_method as method",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue")
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
```

- [ ] **Step 2: Add orders query methods to DashboardRepository**

```ts
  async getOrdersStats(days: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const baseQuery = db("orders")
      .where("orders.created_at", ">=", cutoff)
      .whereNull("orders.deleted_at");

    const byHour = await baseQuery
      .clone()
      .groupBy(db.raw("EXTRACT(HOUR FROM orders.created_at)::int"))
      .select(
        db.raw("EXTRACT(HOUR FROM orders.created_at)::int as hour"),
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue")
      )
      .orderBy("hour");

    const topProducts = await db("order_items")
      .join("product_variants", "product_variants.id", "order_items.variant_id")
      .join("products", "products.id", "product_variants.product_id")
      .join("orders", "orders.id", "order_items.order_id")
      .where("orders.created_at", ">=", cutoff)
      .whereNull("orders.deleted_at")
      .whereNull("product_variants.deleted_at")
      .whereNull("products.deleted_at")
      .groupBy(
        "products.id",
        "products.name",
        "product_variants.name"
      )
      .select(
        "products.id as product_id",
        "products.name as product_name",
        "product_variants.name as variant_name",
        db.raw("SUM(order_items.quantity)::int as total_sold"),
        db.raw("COALESCE(SUM(order_items.quantity * order_items.unit_price), 0) as revenue")
      )
      .orderBy("total_sold", "desc")
      .limit(20);

    const aovRow = await baseQuery
      .clone()
      .select(db.raw("COALESCE(ROUND(AVG(total_amount)::decimal, 2), 0) as aov"))
      .first();

    const revenueTrend = await baseQuery
      .clone()
      .groupBy(db.raw("DATE(orders.created_at)"))
      .select(
        db.raw("DATE(orders.created_at)::text as date"),
        db.raw("COALESCE(SUM(total_amount), 0) as revenue"),
        db.raw("COUNT(*)::int as orders")
      )
      .orderBy("date", "desc")
      .limit(30);

    const byStatus = await baseQuery
      .clone()
      .groupBy("status")
      .select(
        "status",
        db.raw("COUNT(*)::int as count")
      )
      .orderBy("count", "desc");

    const customerStats = await baseQuery
      .clone()
      .select(
        db.raw("COUNT(DISTINCT customer_email)::int as unique_customers")
      )
      .first();

    const repeatCustomers = await db("orders")
      .where("orders.created_at", ">=", cutoff)
      .whereNull("orders.deleted_at")
      .whereNotNull("customer_email")
      .groupBy("customer_email")
      .havingRaw("COUNT(*) > 1")
      .select(db.raw("COUNT(*)::int as repeat_customers"))
      .first();

    const unique = customerStats?.unique_customers ?? 0;
    const repeat = repeatCustomers?.repeat_customers ?? 0;

    return {
      by_hour: byHour,
      top_products: topProducts,
      average_order_value: aovRow?.aov ?? 0,
      revenue_trend: revenueTrend,
      by_status: byStatus,
      repeat_customers: {
        unique_customers: unique,
        repeat_customers: repeat,
        repeat_rate: unique > 0 ? Math.round((repeat / unique) * 100) / 100 : 0,
      },
    };
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/repositories/dashboard.repository.ts
git commit -m "feat: add marketing and orders queries to dashboard repository"
```

---

### Task 4: Dashboard Service

**Files:**
- Create: `src/services/dashboard.service.ts`

**Interfaces:**
- Consumes: `dashboardRepository`
- Produces: `getStockStats(days?)`, `getMarketingStats(days?)`, `getOrdersStats(days?)`

- [ ] **Step 1: Create the service file**

```ts
import { dashboardRepository } from "../repositories/dashboard.repository.js";

export class DashboardService {
  async getStockStats(days = 30) {
    const [lowStock, noSales, turnover, stockValue, deadStock] =
      await Promise.all([
        dashboardRepository.getLowStock(),
        dashboardRepository.getNoSales30d(days),
        dashboardRepository.getTurnoverRate(days),
        dashboardRepository.getStockValueByCategory(),
        dashboardRepository.getDeadStock(90),
      ]);

    return {
      low_stock: lowStock,
      no_sales_30d: noSales,
      turnover_rate: turnover,
      stock_value_by_category: stockValue,
      dead_stock: deadStock,
    };
  }

  async getMarketingStats(days = 30) {
    return dashboardRepository.getMarketingStats(days);
  }

  async getOrdersStats(days = 30) {
    return dashboardRepository.getOrdersStats(days);
  }
}

export const dashboardService = new DashboardService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/dashboard.service.ts
git commit -m "feat: add dashboard service"
```

---

### Task 5: Dashboard Router

**Files:**
- Create: `src/routers/dashboard.router.ts`

**Interfaces:**
- Consumes: `dashboardService`, `DashboardStockResponse`, `DashboardMarketingResponse`, `DashboardOrdersResponse`
- Produces: Fastify plugin with 3 GET endpoints

- [ ] **Step 1: Create the router file**

```ts
import type { FastifyPluginAsync } from "fastify";
import { dashboardService } from "../services/dashboard.service.js";
import {
  DashboardStockResponse,
  DashboardMarketingResponse,
  DashboardOrdersResponse,
} from "../schemas/dashboard.schema.js";
import { z } from "zod";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/dashboard/stock",
    { onRequest: [app.authenticate] },
    async (_request, reply) => {
      try {
        const data = await dashboardService.getStockStats();
        return reply.send(DashboardStockResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  app.get(
    "/dashboard/marketing",
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          days: z.coerce.number().default(30),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { days } = request.query as { days: number };
        const data = await dashboardService.getMarketingStats(days);
        return reply.send(DashboardMarketingResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  app.get(
    "/dashboard/orders",
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          days: z.coerce.number().default(30),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { days } = request.query as { days: number };
        const data = await dashboardService.getOrdersStats(days);
        return reply.send(DashboardOrdersResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );
};
```

- [ ] **Step 2: Register the router in the main app**

```ts
// In src/server.ts or wherever routes are registered:
import { dashboardRoutes } from "./routers/dashboard.router.js";
// ...
await app.register(dashboardRoutes, { prefix: "/api" });
```

Check which file registers routes:

- [ ] **Step 3: Commit**

```bash
git add src/routers/dashboard.router.ts
git commit -m "feat: add dashboard router with stock/marketing/orders endpoints"
```

---

### Task 6: Register Dashboard Routes in Server

**Files:**
- Modify: `src/server.ts` (or wherever routes are registered)

- [ ] **Step 1: Find where routes are registered**

Check `src/server.ts` for route registration pattern.

- [ ] **Step 2: Add dashboard route registration**

```ts
import { dashboardRoutes } from "./routers/dashboard.router.js";
// ...
await app.register(dashboardRoutes, { prefix: "/api" });
```

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: register dashboard routes"
```

---

### Task 7: Integration Tests

**Files:**
- Create: `src/services/dashboard.service.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { dashboardService } from "./dashboard.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase } from "../test/setup.js";

describe("DashboardService Integration Tests", () => {
  const productId = "00000000-0000-0000-0000-000000000001";
  const variantId = "00000000-0000-0000-0000-000000000002";
  const orderId = "00000000-0000-0000-0000-000000000003";

  before(async () => {
    await cleanupDatabase();

    // Create a product with a variant
    await db("products").insert({
      id: productId,
      slug: "test-product",
      name: "Test Product",
      category: "Category A",
      is_active: true,
    });

    await db("product_variants").insert({
      id: variantId,
      product_id: productId,
      name: "Test Variant",
      sku: "TV-001",
      price: 100.00,
      stock_quantity: 10,
      cost_price: 40.00,
      packaging_cost: 5.00,
      platform_fee_percent: 10.00,
      fixed_fee: 0,
    });

    // Create an order
    await db("orders").insert({
      id: orderId,
      customer_name: "Test Customer",
      status: "PAID",
      total_amount: 200.00,
      storefront: "web",
      shipping_province: "SP",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "summer_sale",
      payment_method: "credit_card",
      customer_email: "customer@test.com",
      created_at: new Date(),
    });

    // Add order item
    await db("order_items").insert({
      order_id: orderId,
      variant_id: variantId,
      quantity: 2,
      unit_price: 100.00,
      unit_cost: 40.00,
      unit_packaging_cost: 5.00,
      unit_platform_fee: 10.00,
    });
  });

  after(async () => {
    await cleanupDatabase();
  });

  it("should return stock stats", async () => {
    const result = await dashboardService.getStockStats(30);

    assert.ok(Array.isArray(result.low_stock));
    assert.ok(Array.isArray(result.no_sales_30d));
    assert.ok(Array.isArray(result.turnover_rate));
    assert.ok(Array.isArray(result.stock_value_by_category));
    assert.ok(Array.isArray(result.dead_stock));
    // Our variant has stock=10 which is > 5, so low_stock should be empty
    assert.strictEqual(result.low_stock.length, 0);
    // turnover_rate should have our variant
    assert.strictEqual(result.turnover_rate.length, 1);
    assert.strictEqual(result.turnover_rate[0]!.product_id, productId);
    // stock_value_by_category should have Category A
    const catA = result.stock_value_by_category.find(
      (c: any) => c.category === "Category A"
    );
    assert.ok(catA);
    assert.strictEqual(catA.total_value, 400); // 10 * 40
    assert.strictEqual(catA.variant_count, 1);
  });

  it("should return marketing stats", async () => {
    const result = await dashboardService.getMarketingStats(30);

    assert.ok(Array.isArray(result.by_storefront));
    assert.ok(Array.isArray(result.by_province));
    assert.ok(Array.isArray(result.by_campaign));
    assert.ok(Array.isArray(result.by_source));
    assert.ok(Array.isArray(result.by_payment_method));

    const web = result.by_storefront.find((s: any) => s.storefront === "web");
    assert.ok(web);
    assert.strictEqual(web.orders, 1);
    assert.strictEqual(web.revenue, 200);

    const sp = result.by_province.find((p: any) => p.province === "SP");
    assert.ok(sp);
    assert.strictEqual(sp.orders, 1);

    const campaign = result.by_campaign.find(
      (c: any) => c.campaign === "summer_sale"
    );
    assert.ok(campaign);
    assert.strictEqual(campaign.aov, 200);
  });

  it("should return order stats", async () => {
    const result = await dashboardService.getOrdersStats(30);

    assert.ok(Array.isArray(result.by_hour));
    assert.ok(result.by_hour.length > 0);
    assert.ok(result.by_hour[0]!.hour >= 0);

    assert.ok(Array.isArray(result.top_products));
    assert.strictEqual(result.top_products.length, 1);
    assert.strictEqual(result.top_products[0]!.total_sold, 2);
    assert.strictEqual(result.top_products[0]!.revenue, 200);

    assert.strictEqual(result.average_order_value, 200);

    assert.ok(Array.isArray(result.revenue_trend));
    assert.strictEqual(result.revenue_trend.length, 1);

    assert.ok(Array.isArray(result.by_status));
    const paid = result.by_status.find((s: any) => s.status === "PAID");
    assert.ok(paid);
    assert.strictEqual(paid.count, 1);

    assert.strictEqual(result.repeat_customers.unique_customers, 1);
    assert.strictEqual(result.repeat_customers.repeat_customers, 0);
    assert.strictEqual(result.repeat_customers.repeat_rate, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test
```
Expected: fails because functions don't exist yet (if tasks are being done in order).

- [ ] **Step 3: Run tests to verify they pass**

After all implementation tasks are complete, run:
```bash
npm test
```
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/dashboard.service.integration.test.ts
git commit -m "test: add dashboard service integration tests"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Check linting and types**

```bash
npx tsc --noEmit 2>&1 || true
```

- [ ] **Step 2: Run full test suite**

```bash
npm test 2>&1
```
Expected: ALL tests pass (existing + new dashboard tests).

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address review feedback"
```
