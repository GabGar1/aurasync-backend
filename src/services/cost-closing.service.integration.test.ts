import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert";
import { costClosingService } from "./cost-closing.service.js";
import { costService } from "./cost.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CostClosingService Integration Tests", () => {
  before(async () => { await cleanupDatabase(); });
  beforeEach(async () => { await cleanupDatabase(); });
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

  it("removes stale allocations for deactivated components on re-close", async () => {
    const component = await costService.createComponent({
      name: "Equipe Desativada", type: "MONTHLY_FIXED", value: 1000, allocation_basis: "PER_ORDER",
    } as any);

    const [p] = await db('products').insert({ slug: 'cc-prod-deact', name: 'Prod Deact' }).returning('*');
    const [v] = await db('product_variants').insert({ product_id: p.id, price: 100, stock_quantity: 10 }).returning('*');

    const orderIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [o] = await db('orders').insert({
        customer_name: `D${i}`, status: 'PAID', total_amount: 250, source: 'EXTERNAL', created_at: new Date('2026-08-10T12:00:00Z'),
      }).returning('*');
      await db('order_items').insert({ order_id: o.id, variant_id: v.id, quantity: 1, unit_price: 250, status: true });
      orderIds.push(o.id);
    }

    await costClosingService.closeMonth({ month: '2026-08' });
    const before = await db('order_monthly_allocations')
      .where('cost_component_id', component.id)
      .where('period_start', '2026-08-01')
      .count('* as count').first();
    assert.strictEqual(Number(before!.count), 2);

    await db('cost_components').where({ id: component.id }).update({ is_active: false });

    await costClosingService.closeMonth({ month: '2026-08' });

    const after = await db('order_monthly_allocations')
      .where('cost_component_id', component.id)
      .count('* as count').first();
    assert.strictEqual(Number(after!.count), 0);

    for (const id of orderIds) {
      const order = await db('orders').where({ id }).first();
      assert.strictEqual(Number(order.monthly_cost_total), 0);
    }
  });

  it("uses the store's local day for the month boundaries, like the dashboard (B12)", async () => {
    await costService.createComponent({
      name: "Equipe TZ", type: "MONTHLY_FIXED", value: 900, allocation_basis: "PER_ORDER",
    } as any);
    // 2026-08-01T02:30Z = 31/07/2026 23:30 in America/Sao_Paulo: a July sale.
    const [lateJuly] = await db('orders').insert({
      customer_name: 'Late July', status: 'PAID', total_amount: 100, source: 'EXTERNAL', created_at: new Date('2026-08-01T02:30:00Z'),
    }).returning('*');
    // 2026-09-01T01:00Z = 31/08/2026 22:00 local: still an August sale.
    const [lateAugust] = await db('orders').insert({
      customer_name: 'Late August', status: 'PAID', total_amount: 100, source: 'EXTERNAL', created_at: new Date('2026-09-01T01:00:00Z'),
    }).returning('*');

    const july = await costClosingService.closeMonth({ month: '2026-07' });
    const august = await costClosingService.closeMonth({ month: '2026-08' });

    assert.strictEqual(july.orders, 1);
    assert.strictEqual(august.orders, 1);
    assert.strictEqual(Number((await db('orders').where({ id: lateJuly.id }).first()).monthly_cost_total), 900);
    assert.strictEqual(Number((await db('orders').where({ id: lateAugust.id }).first()).monthly_cost_total), 900);
  });

  it("refuses a closing that overlaps a different period already closed (B12)", async () => {
    await costService.createComponent({
      name: "Equipe Overlap", type: "MONTHLY_FIXED", value: 1000, allocation_basis: "PER_ORDER",
    } as any);
    const [o] = await db('orders').insert({
      customer_name: 'Overlap', status: 'PAID', total_amount: 100, source: 'EXTERNAL', created_at: new Date('2026-08-20T15:00:00Z'),
    }).returning('*');

    await costClosingService.closeMonth({ month: '2026-08' });
    await assert.rejects(
      () => costClosingService.closeMonth({ start_date: '2026-08-15', end_date: '2026-09-14' }),
      (err: any) => err.statusCode === 409,
    );

    // Closing the same period again is still allowed (idempotent) and nothing was duplicated.
    await costClosingService.closeMonth({ month: '2026-08' });
    const rows = await db('order_monthly_allocations').where({ order_id: o.id });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(Number((await db('orders').where({ id: o.id }).first()).monthly_cost_total), 1000);
  });
});
