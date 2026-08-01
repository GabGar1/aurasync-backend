import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { externalSaleService } from "./external-sale.service.js";
import { productService } from "./product.service.js";
import { costService } from "./cost.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("ExternalSaleService Integration Tests", () => {
  let variantId: string;
  let productId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "external-sale-test",
      name: "External Sale Product",
      variants: [{ price: 80, stock_quantity: 20, cost_price: 30, packaging_cost: 2, platform_fee_percent: 2 }],
    });
    productId = product.id;
    variantId = product.variants[0]!.id;
  });

  after(async () => {
    await cleanupDatabase();
    await closeDatabase();
  });

  it("creates an external sale with source EXTERNAL, stock deduction and inventory tx", async () => {
    const component = await costService.createComponent({ name: "Etiqueta", type: "FIXED", value: 0.5 });
    await costService.associateComponent({ product_id: productId, cost_component_id: component.id, quantity: 2 });

    const order = await externalSaleService.createExternalSale({
      customer_name: "Cliente Externo",
      customer_email: "cliente@externo.com",
      items: [{ variant_id: variantId, quantity: 2, unit_price: 80 }],
      payment_method: "credit_card",
      gateway: "stone",
      shipping_cost_owner: 10,
      discount_amount: 10,
    });

    assert.ok(order.id);
    assert.strictEqual(order.source, "EXTERNAL");
    assert.strictEqual(Number(order.total_amount), 150); // 160 - 10
    assert.strictEqual(order.items.length, 1);
    const item = order.items[0]!;
    // etiqueta FIXED=0.5 qty2 -> unit_other_cost 1.0; freight 10 * 100% share / 2 qty -> unit_shipping_cost 5
    assert.strictEqual(Number(item.unit_other_cost), 1);
    assert.strictEqual(Number(item.unit_shipping_cost), 5);
    assert.strictEqual(Number(item.unit_total_cost), 36); // 30 (produto) + 1 (etiqueta) + 5 (frete)
    assert.strictEqual(Number(item.unit_profit), 39); // net unit revenue 75 - 36
    assert.ok(Array.isArray(item.cost_breakdown));
    assert.strictEqual(Number(order.total_cost), 72); // 36 * 2 qty
    assert.strictEqual(Number(order.total_profit), 78); // 150 - 72

    const variant = await db("product_variants").where({ id: variantId }).first();
    assert.strictEqual(variant.stock_quantity, 18);

    const tx = await db("inventory_transactions").where({ variant_id: variantId, order_id: order.id }).first();
    assert.ok(tx);
    assert.strictEqual(tx.type, "SALE");
    assert.strictEqual(tx.quantity_changed, -2);
  });

  it("fails with rollback on insufficient stock", async () => {
    await assert.rejects(
      async () => await externalSaleService.createExternalSale({
        customer_name: "Over Sale",
        items: [{ variant_id: variantId, quantity: 999, unit_price: 80 }],
      }),
      (err: Error) => err.message.includes("Insufficient stock")
    );

    const persisted = await db("orders").where({ customer_name: "Over Sale" }).first();
    assert.strictEqual(persisted, undefined);
    const tx = await db("inventory_transactions")
      .where({ variant_id: variantId })
      .where("quantity_changed", -999)
      .first();
    assert.strictEqual(tx, undefined);
  });
});
