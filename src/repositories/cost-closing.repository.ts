import { db } from '../lib/db.js';
import type { MonthlyComponent } from '../lib/monthly-cost-engine.js';

function toMonthlyComponent(row: any): MonthlyComponent {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    value: Number(row.value),
    allocation_basis: row.allocation_basis,
  };
}

export class CostClosingRepository {
  async listMonthlyComponents(start: string, end: string): Promise<MonthlyComponent[]> {
    const rows = await db('cost_components')
      .whereNull('deleted_at')
      .where('is_active', true)
      .whereIn('type', ['MONTHLY_FIXED', 'MONTHLY_PERCENT'])
      .andWhere(function (this: any) {
        this.whereNull('period_start').orWhere('period_start', '<=', end);
      })
      .andWhere(function (this: any) {
        this.whereNull('period_end').orWhere('period_end', '>=', start);
      });
    return rows.map(toMonthlyComponent);
  }

  async aggregateOrders(start: string, end: string) {
    const orders = await db('orders')
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .where('created_at', '>=', start)
      .andWhere('created_at', '<', end)
      .select('id', 'total_amount');

    const revenue = orders.reduce((s, o) => s + Number(o.total_amount), 0);

    const orderRows = await db('order_items')
      .join('orders', 'orders.id', 'order_items.order_id')
      .where('orders.created_at', '>=', start)
      .andWhere('orders.created_at', '<', end)
      .where('orders.status', '<>', 'CANCELED')
      .whereNull('orders.deleted_at')
      .where('order_items.status', true)
      .groupBy('orders.id')
      .select('orders.id as order_id', db.raw('COALESCE(SUM(order_items.quantity), 0)::int as product_count'));

    const orderCountByProduct = new Map((orderRows as any[]).map((r) => [r.order_id, Number(r.product_count)]));
    const productCount = [...orderCountByProduct.values()].reduce((s, n) => s + n, 0);

    return {
      revenue,
      order_count: orders.length,
      product_count: productCount,
      orders: orders.map((o: any) => ({
        order_id: o.id,
        product_count: orderCountByProduct.get(o.id) ?? 0,
      })),
    };
  }

  async applyAllocations(
    allocations: Array<{ order_id: string; cost_component_id: string; amount: number }>,
    componentIds: string[],
    start: string,
    end: string
  ) {
    return await db.transaction(async (trx) => {
      if (componentIds.length > 0) {
        await trx('order_monthly_allocations')
          .whereIn('cost_component_id', componentIds)
          .where('period_start', start)
          .where('period_end', end)
          .del();
      }

      if (allocations.length > 0) {
        await trx('order_monthly_allocations').insert(
          allocations.map((a) => ({
            order_id: a.order_id,
            cost_component_id: a.cost_component_id,
            amount: a.amount,
            period_start: start,
            period_end: end,
          }))
        );
      }

      const perOrder = await trx('order_monthly_allocations')
        .where('period_start', start)
        .where('period_end', end)
        .groupBy('order_id')
        .select('order_id', db.raw('COALESCE(SUM(amount), 0)::float8 as total'));

      for (const row of perOrder as any[]) {
        await trx('orders').where({ id: row.order_id }).update({
          monthly_cost_total: Number(row.total),
          updated_at: new Date(),
        });
      }
    });
  }
}

export const costClosingRepository = new CostClosingRepository();
