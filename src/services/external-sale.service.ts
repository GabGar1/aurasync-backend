import { ExternalSaleSchema, type ExternalSaleCreate } from '../schemas/external-sale.schema.js';
import { externalSaleRepository, type ExternalSaleInput } from '../repositories/external-sale.repository.js';
import { costRepository } from '../repositories/cost.repository.js';
import { computeOrderCosts, type CostEngineItemInput } from '../lib/cost-engine.js';
import { db } from '../lib/db.js';
import { websocketManager } from '../lib/websocket.js';

export class ExternalSaleService {
  async createExternalSale(data: ExternalSaleCreate) {
    const validated = ExternalSaleSchema.create.parse(data);

    const variantIds = validated.items.map(i => i.variant_id);
    const variants = await db('product_variants')
      .whereIn('id', variantIds)
      .whereNull('deleted_at')
      .select('id', 'product_id', 'cost_price', 'packaging_cost', 'platform_fee_percent');
    if (variants.length !== variantIds.length) {
      throw new Error('One or more variants were not found');
    }
    const variantMap = new Map(variants.map(v => [v.id, v]));
    const productIds = [...new Set(variants.map(v => v.product_id))];
    const componentsByProduct = new Map<string, any[]>();
    for (const row of await costRepository.getComponentsByProductIds(productIds)) {
      if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
      componentsByProduct.get(row.product_id)!.push(row);
    }

    const engineItems: CostEngineItemInput[] = validated.items.map(item => {
      const v = variantMap.get(item.variant_id)!;
      return {
        variant_id: item.variant_id,
        product_id: v.product_id,
        unit_price: item.unit_price,
        quantity: item.quantity,
        product_cost: Number(v.cost_price || 0),
        legacy_packaging_cost: Number(v.packaging_cost || 0),
        legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
        components: (componentsByProduct.get(v.product_id) || []).map((c: any) => ({
          id: c.id, name: c.name, type: c.type, category: c.category,
          value: Number(c.value), calculation_base: c.calculation_base, quantity: c.quantity,
        })),
      };
    });

    const costResult = computeOrderCosts(engineItems, {
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      discount_amount: validated.discount_amount ?? 0,
    });

    const input: ExternalSaleInput = {
      customer_name: validated.customer_name,
      customer_email: validated.customer_email ?? null,
      items: validated.items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price })),
      discount_amount: validated.discount_amount ?? 0,
      payment_method: validated.payment_method ?? null,
      gateway: validated.gateway ?? null,
      payment_installments: validated.payment_installments ?? null,
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      shipping_cost_customer: validated.shipping_cost_customer ?? 0,
      status: validated.status ?? 'PAID',
    };

    const order = await externalSaleRepository.createExternalSale(input, costResult);

    // TODO(Phase 4): upsert customer via customerService.upsertFromOrder once the Customer module exists

    websocketManager.broadcast({
      event: 'orders_updated',
      message: `External sale ${order.id} created.`,
      orderId: order.id,
    });

    return order;
  }
}

export const externalSaleService = new ExternalSaleService();
