import type { Knex } from 'knex';
import { BadRequestError } from '../lib/errors.js';

export interface ReconcileOptions {
  /** Refuse to take more stock than available (local orders). Nuvemshop orders already happened, so they are not strict. */
  strict: boolean;
}

/**
 * Single stock rule for orders. The stock an order should hold is derived from its
 * state (active items, unless CANCELED); what it already holds is the sum of its
 * inventory_transactions. Only the difference is applied, so the same order can be
 * processed any number of times (webhook redeliveries, re-syncs, cancel/reopen).
 */
export class StockRepository {
  async getStockBaseline(trx: Knex | Knex.Transaction): Promise<Date | null> {
    const row = await trx('integration_sync_state').where({ resource: 'stock_baseline' }).first();
    return row ? new Date(row.last_synced_at) : null;
  }

  async reconcileOrderStock(trx: Knex.Transaction, orderId: string, options: ReconcileOptions): Promise<void> {
    const order = await trx('orders').where({ id: orderId }).first();
    if (!order) return;

    const held = new Map<string, number>();
    for (const row of await trx('inventory_transactions')
      .where({ order_id: orderId })
      .groupBy('variant_id')
      .select('variant_id', trx.raw('SUM(quantity_changed)::int as total'))) {
      held.set(row.variant_id, Number(row.total));
    }

    // Orders that predate stock control were already reflected in the imported stock.
    if (held.size === 0) {
      const baseline = await this.getStockBaseline(trx);
      if (baseline && new Date(order.created_at) < baseline) return;
    }

    const target = new Map<string, number>();
    if (order.status !== 'CANCELED' && !order.deleted_at) {
      for (const item of await trx('order_items').where({ order_id: orderId, status: true }).select('variant_id', 'quantity')) {
        target.set(item.variant_id, (target.get(item.variant_id) ?? 0) - Number(item.quantity));
      }
    }

    // Sorted locking order avoids deadlocks between concurrent orders sharing variants.
    const variantIds = [...new Set([...held.keys(), ...target.keys()])].sort();
    for (const variantId of variantIds) {
      const diff = (target.get(variantId) ?? 0) - (held.get(variantId) ?? 0);
      if (diff === 0) continue;

      // FOR NO KEY UPDATE: inserting order_items already holds a KEY SHARE lock on the variant
      // (foreign key); FOR UPDATE would conflict with it and deadlock concurrent orders.
      const variant = await trx('product_variants').where({ id: variantId }).forNoKeyUpdate().first();
      if (!variant) continue;

      if (options.strict && diff < 0 && variant.stock_quantity + diff < 0) {
        throw new BadRequestError(
          `Insufficient stock for variant ${variantId}. Available: ${variant.stock_quantity}, requested: ${-diff}`
        );
      }

      await trx('product_variants')
        .where({ id: variantId })
        .update({ stock_quantity: variant.stock_quantity + diff, updated_at: new Date() });
      await trx('inventory_transactions').insert({
        variant_id: variantId,
        order_id: orderId,
        quantity_changed: diff,
        type: diff < 0 ? 'SALE' : 'RESTOCK',
      });
    }
  }
}

export const stockRepository = new StockRepository();
