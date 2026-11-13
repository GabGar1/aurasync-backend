import { db } from '../lib/db.js';
import type { MonthlyComponent } from '../lib/monthly-cost-engine.js';
import { localDateToUtc } from '../lib/store-time.js';

/** [start, end) as store-local days: an order at 23:30 local on the last day belongs to the period. */
function orderWindow(start: string, end: string) {
  return { from: localDateToUtc(start), to: localDateToUtc(end) };
}

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

  /** Another closed period sharing days with [start, end); re-closing the exact same period is not an overlap. */
  async findOverlappingPeriod(start: string, end: string): Promise<{ period_start: string; period_end: string } | null> {
    const row = await db('order_monthly_allocations')
      .where('period_start', '<', end)
      .andWhere('period_end', '>', start)
      .whereNot(function (this: any) {
        this.where('period_start', start).andWhere('period_end', end);
      })
      .select(
        db.raw("to_char(period_start, 'YYYY-MM-DD') as period_start"),
        db.raw("to_char(period_end, 'YYYY-MM-DD') as period_end")
      )
      .first();
    return row ?? null;
  }

  /** Closed periods, newest first, with how many orders received costs and the total distributed. */
  async listClosings() {
    const rows = await db('order_monthly_allocations')
      .groupBy('period_start', 'period_end')
      .select(
        db.raw("to_char(period_start, 'YYYY-MM-DD') as period_start"),
        db.raw("to_char(period_end, 'YYYY-MM-DD') as period_end"),
        db.raw('COUNT(DISTINCT order_id)::int as orders'),
        db.raw('COALESCE(SUM(amount), 0)::float8 as total_allocated'),
        db.raw('MAX(created_at) as closed_at')
      )
      .orderBy('period_start', 'desc');
    return rows.map((r: any) => ({ ...r, total_allocated: Math.round(Number(r.total_allocated) * 100) / 100 }));
  }

  async aggregateOrders(start: string, end: string) {
    const { from, to } = orderWindow(start, end);
    const orders = await db('orders')
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .where('created_at', '>=', from)
      .andWhere('created_at', '<', to)
      .select('id', 'total_amount');

    const revenue = orders.reduce((s, o) => s + Number(o.total_amount), 0);

    const orderRows = await db('order_items')
      .join('orders', 'orders.id', 'order_items.order_id')
      .where('orders.created_at', '>=', from)
      .andWhere('orders.created_at', '<', to)
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
    start: string,
    end: string
  ) {
    return await db.transaction(async (trx) => {
      await trx('order_monthly_allocations')
        .where('period_start', start)
        .where('period_end', end)
        .del();

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

      const { from, to } = orderWindow(start, end);
      const periodOrders = await trx('orders')
        .whereNull('deleted_at')
        .where('status', '<>', 'CANCELED')
        .where('created_at', '>=', from)
        .andWhere('created_at', '<', to)
        .select('id');

      const perOrder = await trx('order_monthly_allocations')
        .where('period_start', start)
        .where('period_end', end)
        .groupBy('order_id')
        .select('order_id', db.raw('COALESCE(SUM(amount), 0)::float8 as total'));

      const totalsByOrder = new Map((perOrder as any[]).map((r) => [r.order_id, Number(r.total)]));

      for (const row of periodOrders as any[]) {
        await trx('orders').where({ id: row.id }).update({
          monthly_cost_total: totalsByOrder.get(row.id) ?? 0,
          updated_at: new Date(),
        });
      }
    });
  }
}

export const costClosingRepository = new CostClosingRepository();
