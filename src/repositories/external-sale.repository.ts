import { db } from '../lib/db.js';
import type { OrderCostResult } from '../lib/cost-engine.js';

export interface ExternalSaleItemInput {
  variant_id: string;
  quantity: number;
  unit_price: number;
}

export interface ExternalSaleInput {
  customer_name: string;
  customer_email?: string | null;
  items: ExternalSaleItemInput[];
  discount_amount: number;
  payment_method?: string | null;
  gateway?: string | null;
  payment_installments?: number | null;
  shipping_cost_owner: number;
  shipping_cost_customer: number;
  status: string;
  is_fair: boolean;
}

export class ExternalSaleRepository {
  private ordersTable = 'orders';
  private itemsTable = 'order_items';

  async createExternalSale(
    input: ExternalSaleInput,
    costResult: OrderCostResult
  ) {
    return await db.transaction(async (trx) => {
      const grossTotal = input.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
      const totalAmount = grossTotal - input.discount_amount;

      const [order] = await trx(this.ordersTable)
        .insert({
          customer_name: input.customer_name,
          customer_email: input.customer_email ?? null,
          status: input.status,
          total_amount: totalAmount,
          source: 'EXTERNAL',
          discount_amount: input.discount_amount || null,
          shipping_cost_owner: input.shipping_cost_owner || null,
          shipping_cost_customer: input.shipping_cost_customer || null,
          payment_method: input.payment_method ?? null,
          gateway: input.gateway ?? null,
          payment_installments: input.payment_installments ?? null,
          total_cost: costResult.total_cost,
          total_profit: costResult.total_profit,
          margin_percent: costResult.margin_percent,
          is_fair: input.is_fair ?? false,
        })
        .returning('*');

      const itemsToInsert = input.items.map((item, idx) => {
        const s = costResult.items[idx]!;
        return {
          order_id: order.id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          unit_cost: s.unit_cost,
          unit_packaging_cost: s.unit_packaging_cost,
          unit_platform_fee: s.unit_platform_fee,
          unit_tax: s.unit_tax,
          unit_shipping_cost: s.unit_shipping_cost,
          unit_operational_cost: s.unit_operational_cost,
          unit_marketing_cost: s.unit_marketing_cost,
          unit_other_cost: s.unit_other_cost,
          unit_total_cost: s.unit_total_cost,
          unit_profit: s.unit_profit,
          margin_percent: s.margin_percent,
          cost_breakdown: JSON.stringify(s.cost_breakdown),
          status: true,
        };
      });

      const insertedItems = await trx(this.itemsTable).insert(itemsToInsert).returning('*');

      for (const item of input.items) {
        const variant = await trx('product_variants')
          .where({ id: item.variant_id })
          .forUpdate()
          .first();
        if (!variant) throw new Error(`Product variant ${item.variant_id} not found`);
        if (variant.stock_quantity < item.quantity) {
          throw new Error(`Insufficient stock for variant ${item.variant_id}. Available: ${variant.stock_quantity}, requested: ${item.quantity}`);
        }
        await trx('product_variants')
          .where({ id: item.variant_id })
          .update({ stock_quantity: variant.stock_quantity - item.quantity, updated_at: new Date() });
        await trx('inventory_transactions').insert({
          variant_id: item.variant_id,
          order_id: order.id,
          quantity_changed: -item.quantity,
          type: 'SALE',
        });
      }

      return { ...order, items: insertedItems };
    });
  }
}

export const externalSaleRepository = new ExternalSaleRepository();
