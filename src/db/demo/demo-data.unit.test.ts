import { describe, it } from "node:test";
import assert from "node:assert";
import { buildDemoCatalog, buildDemoOrders, createRng, assertDemoDatabase } from "./demo-data.js";

const TODAY = new Date("2026-11-12T15:00:00Z");

describe("demo data generator", () => {
  it("is deterministic: the same seed gives the same orders", () => {
    const catalog = buildDemoCatalog();
    const a = buildDemoOrders(catalog, createRng(42), TODAY);
    const b = buildDemoOrders(catalog, createRng(42), TODAY);
    assert.deepStrictEqual(a, b);
  });

  it("covers the last months up to today, with realistic statuses and channels", () => {
    const catalog = buildDemoCatalog();
    const orders = buildDemoOrders(catalog, createRng(7), TODAY);
    const dates = orders.map((o) => new Date(o.created_at).getTime());

    assert.ok(orders.length >= 250 && orders.length <= 600, `${orders.length} orders`);
    assert.ok(Math.max(...dates) <= TODAY.getTime());
    assert.ok(Math.min(...dates) >= TODAY.getTime() - 181 * 86_400_000, "at most ~6 months back");
    assert.ok(orders.some((o) => o.status === "cancelled"), "some cancellations");
    assert.ok(orders.some((o) => o.shipping_status === "delivered"));
    assert.ok(new Set(orders.map((o) => o.gateway)).size >= 2);
    assert.ok(orders.every((o) => o.products.length >= 1));
    // Recent days have sales, so the dashboard does not open empty.
    assert.ok(dates.some((d) => d >= TODAY.getTime() - 7 * 86_400_000));
  });

  it("builds a catalog with costs below prices and stock for every variant", () => {
    const catalog = buildDemoCatalog();
    assert.ok(catalog.length >= 20);
    for (const p of catalog) {
      for (const v of p.variants) {
        assert.ok(v.cost_price < v.price, `${p.name}: cost must be below price`);
        assert.ok(v.stock_quantity > 0);
      }
    }
  });

  it("refuses any database whose name does not end with _demo", () => {
    assert.throws(() => assertDemoDatabase("postgresql://u:p@localhost:5433/aurasync"), /_demo/);
    assert.throws(() => assertDemoDatabase(undefined), /_demo/);
    assert.doesNotThrow(() => assertDemoDatabase("postgresql://u:p@localhost:5433/aurasync_demo"));
  });
});
