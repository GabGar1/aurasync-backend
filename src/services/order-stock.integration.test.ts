import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { db } from "../lib/db.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { externalSaleService } from "./external-sale.service.js";
import { orderRepository } from "../repositories/order.repository.js";
import { productRepository } from "../repositories/product.repository.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

/**
 * Stock rule: AuraSync is the source of truth.
 * - Every order (local, external sale or Nuvemshop) moves stock through inventory_transactions.
 * - Cancelling returns the stock; re-processing an order only applies the difference.
 * - The Nuvemshop product sync never overwrites the stock of a variant that already exists.
 */

let variantId: string;
const NUVEM_VARIANT = "NV-STOCK-1";

const stockOf = async (id: string) => (await db("product_variants").where({ id }).first()).stock_quantity as number;
const movementsOf = async (orderId: string) =>
  (await db("inventory_transactions").where({ order_id: orderId }).orderBy("created_at")).map((t) => [t.type, t.quantity_changed]);

const nuvemOrder = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  customer: { name: "Cliente Nuvem" },
  status: "PAID",
  total: 200,
  items: [{ variant_id: NUVEM_VARIANT, quantity: 2, price: 100 }],
  created_at: new Date().toISOString(),
  ...overrides,
});

before(async () => {
  await cleanupDatabase();
});

after(async () => {
  await cleanupDatabase();
  await closeDatabase();
});

beforeEach(async () => {
  await cleanupDatabase();
  const product = await productService.createProduct({
    slug: "stock-rule-product",
    name: "Stock rule product",
    variants: [{ price: 100, stock_quantity: 10, cost_price: 40, nuvemshop_variant_id: NUVEM_VARIANT }],
  } as any);
  variantId = product.variants[0]!.id;
});

describe("Cancelling local orders", () => {
  it("returns the stock and keeps the order visible", async () => {
    const order = await orderService.createOrder({ items: [{ variant_id: variantId, quantity: 3, unit_price: 100 }] });
    assert.strictEqual(await stockOf(variantId), 7);

    await orderService.deleteOrder(order.id);

    assert.strictEqual(await stockOf(variantId), 10);
    assert.deepStrictEqual(await movementsOf(order.id), [["SALE", -3], ["RESTOCK", 3]]);
    const list = await orderService.getOrders(1, 10);
    assert.strictEqual(list.orders.find((o) => o.id === order.id)?.status, "CANCELED");
  });

  it("changing the status to CANCELED has the same effect as the cancel action", async () => {
    const order = await orderService.createOrder({ items: [{ variant_id: variantId, quantity: 3, unit_price: 100 }] });

    await orderService.updateOrder(order.id, { status: "CANCELED" });

    assert.strictEqual(await stockOf(variantId), 10);
    const saved = await orderService.getOrderById(order.id);
    assert.ok(saved?.cancelled_at);
  });

  it("refuses to cancel twice", async () => {
    const order = await orderService.createOrder({ items: [{ variant_id: variantId, quantity: 1, unit_price: 100 }] });
    await orderService.deleteOrder(order.id);
    await assert.rejects(() => orderService.deleteOrder(order.id), (err: any) => err.statusCode === 409);
    assert.strictEqual(await stockOf(variantId), 10);
  });

  it("reopening a canceled order takes the stock again, and fails when there is not enough", async () => {
    const order = await orderService.createOrder({ items: [{ variant_id: variantId, quantity: 4, unit_price: 100 }] });
    await orderService.deleteOrder(order.id);
    await orderService.updateOrder(order.id, { status: "PAID" });
    assert.strictEqual(await stockOf(variantId), 6);

    await orderService.deleteOrder(order.id);
    await db("product_variants").where({ id: variantId }).update({ stock_quantity: 1 });
    await assert.rejects(() => orderService.updateOrder(order.id, { status: "PAID" }), (err: any) => err.statusCode === 400);
    assert.strictEqual((await orderService.getOrderById(order.id))?.status, "CANCELED");
    assert.strictEqual(await stockOf(variantId), 1);
  });

  it("cancelling an external sale returns its stock", async () => {
    const sale = await externalSaleService.createExternalSale({
      customer_name: "Feira",
      items: [{ variant_id: variantId, quantity: 2, unit_price: 100 }],
    } as any);
    assert.strictEqual(await stockOf(variantId), 8);

    await orderService.deleteOrder(sale.id);
    assert.strictEqual(await stockOf(variantId), 10);
  });
});

describe("Nuvemshop orders", () => {
  it("take stock once, even when the same order is processed again", async () => {
    const order = await orderService.upsertOrderFromNuvemshop(nuvemOrder("9001") as any);
    await orderService.upsertOrderFromNuvemshop(nuvemOrder("9001") as any);

    assert.strictEqual(await stockOf(variantId), 8);
    assert.deepStrictEqual(await movementsOf(order.id), [["SALE", -2]]);
  });

  it("apply only the difference when the quantity changes, and return everything when cancelled", async () => {
    const order = await orderService.upsertOrderFromNuvemshop(nuvemOrder("9002") as any);
    await orderService.upsertOrderFromNuvemshop(
      nuvemOrder("9002", { items: [{ variant_id: NUVEM_VARIANT, quantity: 5, price: 100 }] }) as any,
    );
    assert.strictEqual(await stockOf(variantId), 5);

    await orderService.upsertOrderFromNuvemshop(
      nuvemOrder("9002", { status: "CANCELED", items: [{ variant_id: NUVEM_VARIANT, quantity: 5, price: 100 }] }) as any,
    );
    assert.strictEqual(await stockOf(variantId), 10);
    assert.deepStrictEqual(await movementsOf(order.id), [["SALE", -2], ["SALE", -3], ["RESTOCK", 5]]);
  });

  it("are recorded even when they sell more than AuraSync has (stock goes negative)", async () => {
    await orderService.upsertOrderFromNuvemshop(
      nuvemOrder("9003", { items: [{ variant_id: NUVEM_VARIANT, quantity: 12, price: 100 }] }) as any,
    );
    assert.strictEqual(await stockOf(variantId), -2);
  });

  it("created before stock control started do not move stock", async () => {
    await db("integration_sync_state").insert({ resource: "stock_baseline", last_synced_at: new Date("2026-11-01T00:00:00Z") });
    await orderService.upsertOrderFromNuvemshop(nuvemOrder("9004", { created_at: "2026-10-01T10:00:00Z" }) as any);
    assert.strictEqual(await stockOf(variantId), 10);

    await orderService.upsertOrderFromNuvemshop(nuvemOrder("9005", { created_at: "2026-11-02T10:00:00Z" }) as any);
    assert.strictEqual(await stockOf(variantId), 8);
  });

  it("cannot be cancelled or have their status changed locally", async () => {
    const order = await orderService.upsertOrderFromNuvemshop(nuvemOrder("9006") as any);
    await assert.rejects(() => orderService.deleteOrder(order.id), (err: any) => err.statusCode === 409);
    await assert.rejects(() => orderService.updateOrder(order.id, { status: "CANCELED" }), (err: any) => err.statusCode === 409);
    assert.strictEqual(await stockOf(variantId), 8);
  });

  it("keep items whose variant is unknown locally and flag the cost as incomplete", async () => {
    const order = await orderService.upsertOrderFromNuvemshop(
      nuvemOrder("9007", {
        items: [
          { variant_id: NUVEM_VARIANT, quantity: 1, price: 100 },
          { variant_id: "NV-UNKNOWN", quantity: 3, price: 50 },
        ],
      }) as any,
    );

    assert.strictEqual(order.cost_incomplete, true);
    assert.deepStrictEqual(order.missing_items, [{ nuvemshop_variant_id: "NV-UNKNOWN", quantity: 3, unit_price: 50 }]);
    const listed = (await orderService.getOrders(1, 10)).orders.find((o) => o.id === order.id);
    assert.strictEqual(listed?.cost_incomplete, true);
  });
});

describe("Nuvemshop product sync", () => {
  it("does not overwrite the stock of an existing variant but seeds new ones", async () => {
    const product = await db("products").first();
    await db("products").where({ id: product.id }).update({ nuvemshop_id: "NP-1" });

    await productService.upsertProductFromNuvemshop({
      id: "NP-1",
      name: "Stock rule product",
      category: "Geral",
      is_active: true,
      variants: [
        { id: NUVEM_VARIANT, price: 120, stock_quantity: 99 },
        { id: "NV-NEW", price: 80, stock_quantity: 4 },
      ],
    } as any);

    const existing = await db("product_variants").where({ nuvemshop_variant_id: NUVEM_VARIANT }).first();
    assert.strictEqual(existing.stock_quantity, 10);
    assert.strictEqual(Number(existing.price), 120);
    const created = await db("product_variants").where({ nuvemshop_variant_id: "NV-NEW" }).first();
    assert.strictEqual(created.stock_quantity, 4);
  });
});

describe("List queries", () => {
  const countQueries = async (fn: () => Promise<unknown>) => {
    let count = 0;
    const listener = () => { count++; };
    db.on("query", listener);
    try {
      await fn();
    } finally {
      db.removeListener("query", listener);
    }
    return count;
  };

  it("load orders with a fixed number of queries, whatever the page size", async () => {
    for (let i = 0; i < 6; i++) {
      await orderService.createOrder({ items: [{ variant_id: variantId, quantity: 1, unit_price: 100 }] });
    }
    const queries = await countQueries(() => orderRepository.findAll(1, 10));
    assert.ok(queries <= 4, `expected at most 4 queries, got ${queries}`);
    const { orders } = await orderRepository.findAll(1, 10);
    assert.strictEqual(orders.length, 6);
    assert.ok(orders.every((o) => o.items.length === 1));
  });

  it("load products with a fixed number of queries, whatever the page size", async () => {
    for (let i = 0; i < 5; i++) {
      await productService.createProduct({ slug: `extra-${i}`, name: `Extra ${i}`, variants: [{ price: 1, stock_quantity: 1 }] } as any);
    }
    const queries = await countQueries(() => productRepository.findAll(1, 10));
    assert.ok(queries <= 3, `expected at most 3 queries, got ${queries}`);
    const { products } = await productRepository.findAll(1, 10);
    assert.strictEqual(products.length, 6);
    assert.ok(products.every((p) => p.variants.length === 1));
  });
});
