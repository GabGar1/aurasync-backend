import { ExternalSaleSchema, ExternalSalePreviewSchema, type ExternalSaleCreate, type ExternalSalePreview } from '../schemas/external-sale.schema.js';
import { externalSaleRepository, type ExternalSaleInput } from '../repositories/external-sale.repository.js';
import { costRepository } from '../repositories/cost.repository.js';
import { creditFeeRepository } from '../repositories/credit-fee.repository.js';
import { computeOrderCosts } from '../lib/cost-engine.js';
import { websocketManager } from '../lib/websocket.js';
import { customerService } from './customer.service.js';
import { NotFoundError } from '../lib/errors.js';

type ValidatedExternalSale = ReturnType<typeof ExternalSalePreviewSchema.parse>;

export class ExternalSaleService {
  /** Cost of a sale with the same rules used to register it (shared by the preview and the sale). */
  private async computeSale(validated: ValidatedExternalSale) {
    const { items: engineItems, missingVariantIds } = await costRepository.buildCostEngineItems(
      validated.items,
      undefined,
      { activeVariantsOnly: true }
    );
    if (missingVariantIds.length > 0) {
      throw new NotFoundError('One or more variants were not found');
    }

    const installments = validated.payment_installments ?? 1;
    const creditTier = await creditFeeRepository.findByInstallments(installments);

    const grossTotal = engineItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const totalAmount = grossTotal - (validated.discount_amount ?? 0);

    const costResult = computeOrderCosts(engineItems, {
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      discount_amount: validated.discount_amount ?? 0,
      is_fair: validated.is_fair ?? false,
      credit_fee: creditTier ? { percent: Number(creditTier.percent), fixed_fee: Number(creditTier.fixed_fee) } : null,
      total_amount: totalAmount,
    });
    return { grossTotal, totalAmount, costResult };
  }

  /** What the sale would cost and earn, without saving it or touching stock. */
  async previewExternalSale(data: ExternalSalePreview) {
    const validated = ExternalSalePreviewSchema.parse(data);
    const { grossTotal, totalAmount, costResult } = await this.computeSale(validated);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      subtotal: round2(grossTotal),
      discount_amount: round2(validated.discount_amount ?? 0),
      total_amount: round2(totalAmount),
      total_cost: Number(costResult.total_cost),
      total_profit: Number(costResult.total_profit),
      margin_percent: Number(costResult.margin_percent),
    };
  }

  async createExternalSale(data: ExternalSaleCreate) {
    const validated = ExternalSaleSchema.create.parse(data);
    const { costResult } = await this.computeSale(validated);

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
