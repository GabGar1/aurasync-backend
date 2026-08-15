import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { dashboardService } from "./dashboard.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("DashboardService Integration Tests", () => {
  const productId = "00000000-0000-0000-0000-000000000001";
  const variantId = "00000000-0000-0000-0000-000000000002";
  const orderId = "00000000-0000-0000-0000-000000000003";

  before(async () => {
    await cleanupDatabase();

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

    await db("orders").insert({
      id: orderId,
      customer_name: "Test Customer",
      status: "PAID",
      fulfillment_status: "DELIVERED",
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
    await closeDatabase();
  });

  it("should return stock stats", async () => {
    const result = await dashboardService.getStockStats(30);

    assert.ok(Array.isArray(result.low_stock));
    assert.ok(Array.isArray(result.no_sales_30d));
    assert.ok(Array.isArray(result.turnover_rate));
    assert.ok(Array.isArray(result.stock_value_by_category));
    assert.ok(Array.isArray(result.dead_stock));
    assert.strictEqual(result.low_stock.length, 0);
    assert.strictEqual(result.turnover_rate.length, 1);
    assert.strictEqual(result.turnover_rate[0]!.product_id, productId);

    const catA = result.stock_value_by_category.find(
      (c) => c.category === "Category A"
    );
    assert.ok(catA);
    assert.strictEqual(catA.total_value, 400);
    assert.strictEqual(catA.variant_count, 1);
  });

  it("should return marketing stats", async () => {
    const result = await dashboardService.getMarketingStats(30);

    assert.ok(Array.isArray(result.by_storefront));
    assert.ok(Array.isArray(result.by_province));
    assert.ok(Array.isArray(result.by_campaign));
    assert.ok(Array.isArray(result.by_source));
    assert.ok(Array.isArray(result.by_payment_method));

    const web = result.by_storefront.find((s) => s.storefront === "web");
    assert.ok(web);
    assert.strictEqual(web.orders, 1);
    assert.strictEqual(web.revenue, 200);

    const sp = result.by_province.find((p) => p.province === "SP");
    assert.ok(sp);
    assert.strictEqual(sp.orders, 1);

    const campaign = result.by_campaign.find(
      (c) => c.campaign === "summer_sale"
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
    const delivered = result.by_status.find((s) => s.status === "DELIVERED");
    assert.ok(delivered);
    assert.strictEqual(delivered.count, 1);
    assert.strictEqual(delivered.status_label, "Entregue");

    assert.strictEqual(result.repeat_customers.unique_customers, 1);
    assert.strictEqual(result.repeat_customers.repeat_customers, 0);
    assert.strictEqual(result.repeat_customers.repeat_rate, 0);
  });

  it("by_status groups by fulfillment status with translated labels (NULL -> Pendente)", async () => {
    const statuses = [
      { id: "00000000-0000-0000-0000-000000000010", fulfillment_status: "UNPACKED" },
      { id: "00000000-0000-0000-0000-000000000011", fulfillment_status: "DISPATCHED" },
      { id: "00000000-0000-0000-0000-000000000012", fulfillment_status: "MARKED_AS_FULFILLED" },
      { id: "00000000-0000-0000-0000-000000000013", fulfillment_status: null },
    ];
    for (const s of statuses) {
      await db("orders").insert({
        id: s.id,
        customer_name: "Fulfillment Customer",
        status: "PAID",
        fulfillment_status: s.fulfillment_status,
        total_amount: 100.00,
        created_at: new Date(),
      });
    }

    const result = await dashboardService.getOrdersStats(30);
    const labels: Record<string, string> = {
      UNPACKED: "Empacotando",
      DISPATCHED: "Despachado",
      MARKED_AS_FULFILLED: "Marcado como Concluído",
      PENDING: "Pendente",
    };
    for (const [status, label] of Object.entries(labels)) {
      const row = result.by_status.find((s: any) => s.status === status);
      assert.ok(row, `missing by_status row for ${status}`);
      assert.strictEqual(row.status_label, label);
    }
    assert.strictEqual(
      result.by_status.find((s: any) => s.status === "UNPACKED").count,
      1
    );
    assert.strictEqual(
      result.by_status.find((s: any) => s.status === "DISPATCHED").count,
      1
    );
    assert.strictEqual(
      result.by_status.find((s: any) => s.status === "MARKED_AS_FULFILLED").count,
      1
    );

    await db("orders")
      .whereIn(
        "id",
        statuses.map((s) => s.id)
      )
      .del();
  });

  it("includes product category on top products", async () => {
    const result = await dashboardService.getOrdersStats(30);
    const top = result.top_products.find((p: any) => p.product_id === productId);
    assert.ok(top);
    assert.strictEqual(top.category, "Category A");
  });

  it("excludes CANCELED orders from metrics", async () => {
    await db("orders").insert({
      id: "00000000-0000-0000-0000-000000000004",
      customer_name: "Canceled Customer",
      status: "CANCELED",
      total_amount: 999,
      created_at: new Date(),
    });
    const result = await dashboardService.getOrdersStats(30);
    assert.strictEqual(result.average_order_value, 200); // only the PAID order
    const byStatus = result.by_status.find((s: any) => s.status === "CANCELED");
    assert.strictEqual(byStatus, undefined);
  });

  it("respects explicit date filters", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await dashboardService.getMarketingStats(30, {
      start_date: tomorrow,
      end_date: tomorrow,
    });
    assert.strictEqual(result.by_storefront.length, 0);
  });

  it("filters dashboard stats by the store's local day (America/Sao_Paulo)", async () => {
    const boundaryOrderId = "00000000-0000-0000-0000-000000000099";
    // 2026-08-01T02:30Z = 31/07/2026 23:30 em America/Sao_Paulo
    await db("orders").insert({
      id: boundaryOrderId,
      customer_name: "Boundary Customer",
      status: "PAID",
      total_amount: 50.00,
      created_at: new Date("2026-08-01T02:30:00.000Z"),
    });
    await db("order_items").insert({
      order_id: boundaryOrderId,
      variant_id: variantId,
      quantity: 1,
      unit_price: 50.00,
    });

    const onLocalDay = await dashboardService.getOrdersStats(30, {
      start_date: "2026-07-31",
      end_date: "2026-07-31",
    });
    const julyTrend = onLocalDay.revenue_trend.find((d: any) => d.date === "2026-07-31");
    assert.ok(julyTrend, "order realized on 2026-07-31 local should appear in that day's trend");
    assert.ok(
      onLocalDay.by_hour.some((h: any) => h.hour === 23),
      "order at 23:30 local must be bucketed in hour 23, not UTC hour 2"
    );

    const onUtcDay = await dashboardService.getOrdersStats(30, {
      start_date: "2026-08-01",
      end_date: "2026-08-01",
    });
    const augustTrend = onUtcDay.revenue_trend.find((d: any) => d.date === "2026-08-01");
    assert.ok(
      !augustTrend || augustTrend.orders === 0,
      "order realized on 2026-07-31 local must NOT count for 2026-08-01"
    );
  });
});
