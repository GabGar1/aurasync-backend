import { ExternalSaleSchema, type ExternalSaleCreate } from '../schemas/external-sale.schema.js';
import { externalSaleRepository, type ExternalSaleInput } from '../repositories/external-sale.repository.js';
import { costRepository } from '../repositories/cost.repository.js';
import { creditFeeRepository } from '../repositories/credit-fee.repository.js';
import { computeOrderCosts, type CostEngineItemInput } from '../lib/cost-engine.js';
import { db } from '../lib/db.js';
import { websocketManager } from '../lib/websocket.js';
import { customerService } from './customer.service.js';

export class ExternalSaleService {
  async createExternalSale(data: ExternalSaleCreate) {
    const validated = ExternalSaleSchema.create.parse(data);

    const variantIds = validated.items.map(i => i.variant_id);
    const variants = await db('product_variants')
      .join('products', 'products.id', 'product_variants.product_id')
      .whereIn('product_variants.id', variantIds)
      .whereNull('product_variants.deleted_at')
      .select('product_variants.id', 'product_variants.product_id', 'products.subgroup_id', 'product_variants.cost_price', 'product_variants.packaging_cost', 'product_variants.platform_fee_percent');
    if (variants.length !== variantIds.length) {
      throw new Error('One or more variants were not found');
    }
    const variantMap = new Map(variants.map(v => [v.id, v]));
    const productIds = [...new Set(variants.map(v => v.product_id))];
    const subgroupIds = [...new Set(variants.map(v => v.subgroup_id).filter(Boolean))] as string[];

    const toComponent = (c: any) => ({
      id: c.id, name: c.name, type: c.type, category: c.category,
      value: Number(c.value), calculation_base: c.calculation_base, quantity: c.quantity,
      max_products_per_package: c.max_products_per_package,
      consolidates: c.consolidates,
      applies_to_fair_only: c.applies_to_fair_only,
    });

    const componentsByProduct = new Map<string, any[]>();
    for (const row of await costRepository.getComponentsByProductIds(productIds)) {
      if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
      componentsByProduct.get(row.product_id)!.push(row);
    }
    const componentsBySubgroup = new Map<string, any[]>();
    for (const row of await costRepository.getComponentsBySubgroupIds(subgroupIds)) {
      if (!componentsBySubgroup.has(row.subgroup_id)) componentsBySubgroup.set(row.subgroup_id, []);
      componentsBySubgroup.get(row.subgroup_id)!.push(row);
    }

    const installments = validated.payment_installments ?? 1;
    const creditTier = await creditFeeRepository.findByInstallments(installments);

    const engineItems: CostEngineItemInput[] = validated.items.map(item => {
      const v = variantMap.get(item.variant_id)!;
      const productComps = (componentsByProduct.get(v.product_id) || []).map(toComponent);
      const subgroupComps = v.subgroup_id ? (componentsBySubgroup.get(v.subgroup_id) || []).map(toComponent) : [];
      return {
        variant_id: item.variant_id,
        product_id: v.product_id,
        subgroup_id: v.subgroup_id ?? null,
        unit_price: item.unit_price,
        quantity: item.quantity,
        product_cost: Number(v.cost_price || 0),
        legacy_packaging_cost: Number(v.packaging_cost || 0),
        legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
        components: [...productComps, ...subgroupComps],
      };
    });

    const grossTotal = engineItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const totalAmount = grossTotal - (validated.discount_amount ?? 0);

    const costResult = computeOrderCosts(engineItems, {
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      discount_amount: validated.discount_amount ?? 0,
      is_fair: validated.is_fair ?? false,
      credit_fee: creditTier ? { percent: Number(creditTier.percent), fixed_fee: Number(creditTier.fixed_fee) } : null,
      total_amount: totalAmount,
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
      is_fair: validated.is_fair ?? false,
    };

    const order = await externalSaleRepository.createExternalSale(input, costResult);

    const itemMoneyFields = [
      'unit_price', 'unit_cost', 'unit_packaging_cost', 'unit_platform_fee',
      'unit_tax', 'unit_shipping_cost', 'unit_operational_cost', 'unit_marketing_cost',
      'unit_other_cost', 'unit_total_cost', 'unit_profit', 'margin_percent',
    ] as const;
    const orderMoneyFields = ['total_amount', 'total_cost', 'total_profit', 'margin_percent'] as const;
    const orderOptionalMoneyFields = ['discount_amount', 'shipping_cost_owner', 'shipping_cost_customer'] as const;

    const orderResponse = {
      ...order,
      items: (order.items || []).map((item: Record<string, unknown>) => {
        const coerced: Record<string, unknown> = { ...item };
        for (const f of itemMoneyFields) coerced[f] = Number(coerced[f]);
        return coerced;
      }),
    };
    for (const f of orderMoneyFields) orderResponse[f] = Number(orderResponse[f]);
    for (const f of orderOptionalMoneyFields) {
      if (orderResponse[f] != null) orderResponse[f] = Number(orderResponse[f]);
    }

    try {
      await customerService.upsertFromOrder({
        name: validated.customer_name,
        email: validated.customer_email ?? null,
        city: null,
        province: null,
        payment_method: validated.payment_method ?? null,
        gateway: validated.gateway ?? null,
        storefront: 'EXTERNAL',
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        total: orderResponse.total_amount,
        date: orderResponse.created_at,
      });
    } catch (error) {
      console.error("Failed to upsert customer:", error);
    }

    websocketManager.broadcast({
      event: 'orders_updated',
      message: `External sale ${orderResponse.id} created.`,
      orderId: orderResponse.id,
    });

    return orderResponse;
  }
}

export const externalSaleService = new ExternalSaleService();
