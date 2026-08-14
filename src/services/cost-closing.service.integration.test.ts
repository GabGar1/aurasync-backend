import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { costClosingService } from "./cost-closing.service.js";
import { costService } from "./cost.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CostClosingService Integration Tests", () => {
  before(async () => { await cleanupDatabase(); });
  after(async () => { await cleanupDatabase(); await closeDatabase(); });

  it("closes a month, distributing a MONTHLY_FIXED component across orders", async () => {
    const component = await costService.createComponent({
      name: "Equipe", type: "MONTHLY_FIXED", value: 1000, allocation_basis: "PER_ORDER",
    } as any);

    const [p] = await db('products').insert({ slug: 'cc-prod', name: 'Prod' }).returning('*');
    const [v] = await db('product_variants').insert({ product_id: p.id, price: 100, stock_quantity: 10 }).returning('*');

    const orderIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [o] = await db('orders').insert({
        customer_name: `C${i}`, status: 'PAID', total_amount: 250, source: 'EXTERNAL', created_at: new Date('2026-08-10T12:00:00Z'),
      }).returning('*');
      await db('order_items').insert({ order_id: o.id, variant_id: v.id, quantity: 1, unit_price: 250, status: true });
      orderIds.push(o.id);
    }

    const result = await costClosingService.closeMonth({ month: '2026-08' });

    assert.strictEqual(result.orders, 4);
    assert.strictEqual(result.allocations, 4);

    const rows = await db('order_monthly_allocations').select('*');
    assert.strictEqual(rows.length, 4);
    const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
    assert.strictEqual(sum, 1000);

    const order = await db('orders').where({ id: orderIds[0] }).first();
    assert.strictEqual(Number(order.monthly_cost_total), 250);
  });
});
