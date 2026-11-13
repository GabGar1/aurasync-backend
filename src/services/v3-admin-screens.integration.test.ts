import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert";
import { db } from "../lib/db.js";
import { inventoryService } from "./inventory.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { creditFeeService } from "./credit-fee.service.js";
import { costService } from "./cost.service.js";
import { costClosingService } from "./cost-closing.service.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

let variantA: string;
let variantB: string;

before(async () => { await cleanupDatabase(); });
after(async () => { await cleanupDatabase(); await closeDatabase(); });

beforeEach(async () => {
  await cleanupDatabase();
  const a = await productService.createProduct({ slug: "anel-ametista", name: "Anel Ametista", variants: [{ price: 50, stock_quantity: 10, sku: "AN-AM" }] } as any);
  const b = await productService.createProduct({ slug: "colar-quartzo", name: "Colar Quartzo", variants: [{ price: 80, stock_quantity: 10, sku: "CO-QZ" }] } as any);
  variantA = a.variants[0]!.id;
  variantB = b.variants[0]!.id;
});

describe("Inventory history", () => {
  it("returns the paginated shape the screen expects, with product names", async () => {
    await inventoryService.addTransaction({ variant_id: variantA, type: "RESTOCK", quantity_changed: 5 });
    await orderService.createOrder({ items: [{ variant_id: variantB, quantity: 2, unit_price: 80 }] });

    const result = await inventoryService.getGlobalHistory(1, 50);

    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.page, 1);
    assert.strictEqual(result.limit, 50);
    const sale = result.transactions.find((t: any) => t.type === "SALE");
    assert.strictEqual(sale.product_name, "Colar Quartzo");
    assert.strictEqual(sale.sku, "CO-QZ");
    assert.strictEqual(sale.quantity_changed, -2);
  });

  it("filters by type and by product name or SKU, and summarizes entries and exits", async () => {
    await inventoryService.addTransaction({ variant_id: variantA, type: "RESTOCK", quantity_changed: 5 });
    await inventoryService.addTransaction({ variant_id: variantA, type: "ADJUSTMENT", quantity_changed: -1 });
    await orderService.createOrder({ items: [{ variant_id: variantB, quantity: 2, unit_price: 80 }] });

    const restocks = await inventoryService.getGlobalHistory(1, 50, { type: "RESTOCK" });
    assert.deepStrictEqual(restocks.transactions.map((t: any) => t.type), ["RESTOCK"]);

    const bySku = await inventoryService.getGlobalHistory(1, 50, { search: "an-am" });
    assert.strictEqual(bySku.total, 2);

    const all = await inventoryService.getGlobalHistory(1, 50);
    assert.deepStrictEqual(all.summary, { entries: 5, exits: 3, movements: 3 });
  });
});

describe("Credit fee tiers", () => {
  it("creates a tier from the screen and refuses a duplicate installment count", async () => {
    const tier = await creditFeeService.createTier({ installments: 4, percent: 8.5, fixed_fee: 0 });
    assert.strictEqual(tier.installments, 4);
    assert.strictEqual(Number(tier.percent), 8.5);

    await assert.rejects(
      () => creditFeeService.createTier({ installments: 4, percent: 9, fixed_fee: 0 }),
      (err: any) => err.statusCode === 409,
    );
  });
});

describe("Credit fee tiers on/off", () => {
  it("keeps a deactivated tier on the list (so it can be turned back on) but stops charging it", async () => {
    const tier = await creditFeeService.createTier({ installments: 6, percent: 12, fixed_fee: 0 });
    await creditFeeService.updateTier(tier.id, { is_active: false });

    const listed = await creditFeeService.listTiers();
    assert.ok(listed.some((t: any) => t.id === tier.id && t.is_active === false), "inactive tier must stay listed");

    const { creditFeeRepository } = await import("../repositories/credit-fee.repository.js");
    assert.strictEqual(await creditFeeRepository.findByInstallments(6), null, "inactive tier must not be charged");
  });
});

describe("Cost closing history", () => {
  it("lists the closed periods with order count and total allocated, newest first", async () => {
    await costService.createComponent({ name: "Equipe", type: "MONTHLY_FIXED", value: 900, allocation_basis: "PER_ORDER" } as any);
    for (const date of ["2026-07-10T15:00:00Z", "2026-08-10T15:00:00Z", "2026-08-11T15:00:00Z"]) {
      await db("orders").insert({ customer_name: "C", status: "PAID", total_amount: 100, source: "EXTERNAL", created_at: new Date(date) });
    }
    await costClosingService.closeMonth({ month: "2026-07" });
    await costClosingService.closeMonth({ month: "2026-08" });

    const history = await costClosingService.listClosings();

    assert.deepStrictEqual(
      history.map((h: any) => ({ start: h.period_start, end: h.period_end, orders: h.orders, total: h.total_allocated })),
      [
        { start: "2026-08-01", end: "2026-09-01", orders: 2, total: 900 },
        { start: "2026-07-01", end: "2026-08-01", orders: 1, total: 900 },
      ],
    );
    assert.ok(history[0].closed_at);
  });
});
