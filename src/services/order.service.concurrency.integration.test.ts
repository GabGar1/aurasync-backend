import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("OrderService Sync Concurrency (pool deadlock regression)", () => {
  const CONCURRENCY = 12;
  let variantNuvemId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "sync-concurrency-test",
      name: "Sync Concurrency Test",
      variants: [{ price: 50, stock_quantity: 500, cost_price: 20, nuvemshop_variant_id: "SYNC-CONC-1" }],
    });
    variantNuvemId = product.variants[0]!.nuvemshop_variant_id!;
  });

  after(async () => {
    await cleanupDatabase();
    await closeDatabase();
  });

  it(`handles ${CONCURRENCY} concurrent Nuvemshop upserts without pool exhaustion`, async () => {
    const orders = Array.from({ length: CONCURRENCY }, (_, i) => ({
      id: `conc-${1000 + i}`,
      customer: { name: `Concurrent Customer ${i}` },
      status: "PAID",
      total: 100,
      items: [{ variant_id: variantNuvemId, quantity: 1, price: 50 }],
      contact_email: `conc${i}@test.com`,
    }));

    const results = await Promise.allSettled(
      orders.map((o) => orderService.upsertOrderFromNuvemshop(o as any))
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(
      fulfilled.length,
      CONCURRENCY,
      `expected all ${CONCURRENCY} upserts to succeed; ${rejected.length} rejected: ${
        rejected[0]?.status === "rejected" ? String(rejected[0].reason) : ""
      }`
    );

    const persisted = await db("orders").whereIn(
      "nuvemshop_order_id",
      orders.map((o) => o.id)
    );
    assert.strictEqual(persisted.length, CONCURRENCY);
  });
});
