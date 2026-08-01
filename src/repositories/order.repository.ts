import { db } from '../lib/db.js';
import type { Knex } from 'knex';
import { costRepository } from './cost.repository.js';
import { computeOrderCosts, type CostEngineItemInput, type ItemCostSnapshot } from '../lib/cost-engine.js';

// helper: converts a plain DB item row + computed snapshot into the insert payload
function applySnapshot(base: Record<string, unknown>, snapshot: ItemCostSnapshot): Record<string, unknown> {
  return {
    ...base,
    unit_cost: snapshot.unit_cost,
    unit_packaging_cost: snapshot.unit_packaging_cost,
    unit_platform_fee: snapshot.unit_platform_fee,
    unit_tax: snapshot.unit_tax,
    unit_shipping_cost: snapshot.unit_shipping_cost,
    unit_operational_cost: snapshot.unit_operational_cost,
    unit_marketing_cost: snapshot.unit_marketing_cost,
    unit_other_cost: snapshot.unit_other_cost,
    unit_total_cost: snapshot.unit_total_cost,
    unit_profit: snapshot.unit_profit,
    margin_percent: snapshot.margin_percent,
    cost_breakdown: JSON.stringify(snapshot.cost_breakdown),
  };
}

// --- INTERFACES ---

export interface Order {
  id: string;
  nuvemshop_order_id: string | null;
  source: string;
  total_cost: number;
  total_profit: number;
  margin_percent: number;
  customer_name: string | null;
  status: string;
  total_amount: number;
  discount_amount: number | null;
  shipping_cost_customer: number | null;
  shipping_cost_owner: number | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  has_free_shipping: boolean | null;
  paid_at: Date | null;
  shipped_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  payment_method: string | null;
  payment_installments: number | null;
  gateway: string | null;
  shipping_city: string | null;
  shipping_province: string | null;
  shipping_carrier: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  storefront: string | null;
  customer_email: string | null;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItem {
  id: string;
  order_id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  unit_packaging_cost: number;
  unit_platform_fee: number;
  unit_tax: number;
  unit_shipping_cost: number;
  unit_operational_cost: number;
  unit_marketing_cost: number;
  unit_other_cost: number;
  unit_total_cost: number;
  unit_profit: number;
  margin_percent: number;
  cost_breakdown: any[] | null;
  has_promotional_price: boolean | null;
  status: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface CreateOrderItemInput {
  variant_id: string;
  quantity: number;
  unit_price: number;
  unit_cost?: number;
  unit_packaging_cost?: number;
  unit_platform_fee?: number;
}

export interface CreateOrderInput {
  nuvemshop_order_id?: string;
  customer_name?: string;
  status?: string;
  total_amount: number;
  items: CreateOrderItemInput[];
}

export interface NuvemshopOrderItemData {
  variant_id: string; // Nuvemshop's variant ID
  quantity: number;
  price: number;
  has_promotional_price?: boolean;
}

export interface NuvemshopOrderData {
  id: string;
  customer: {
    name: string;
  };
  status: string;
  total: number;
  items: NuvemshopOrderItemData[];
  discount?: string;
  shipping_cost_customer?: string;
  shipping_cost_owner?: string;
  payment_status?: string;
  fulfillments?: Array<{ status: string }>;
  free_shipping_config?: { cart_has_free_shipping?: boolean };
  paid_at?: string | null;
  shipped_at?: string | null;
  completed_at?: { date: string; timezone_type: number; timezone: string } | null;
  cancelled_at?: string | null;
  payment_details?: {
    method?: string;
    credit_card_company?: string;
    installments?: number;
  } | null;
  gateway?: string;
  shipping_address?: {
    city?: string;
    province?: string;
  };
  shipping_carrier_name?: string;
  customer_visit?: {
    utm_parameters?: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      utm_content?: string;
      utm_term?: string;
    };
  };
  storefront?: string;
  contact_email?: string;
}


export interface UpdateOrderInput {
  customer_name?: string;
  status?: string;
}

export class OrderRepository {
  private ordersTable = 'orders';
  private itemsTable = 'order_items';

  /**
   * CREATE
   */
  async create(data: CreateOrderInput): Promise<OrderWithItems> {
    const { items, ...orderData } = data;

    return await db.transaction(async (trx) => {
      const [order] = await trx(this.ordersTable)
        .insert({
          ...orderData,
          status: orderData.status || 'PENDING'
        })
        .returning('*');

      // after inserting the order and BEFORE stock deduction, resolve variants + components
      const variantIds = items.map(i => i.variant_id);
      const variants = await trx('product_variants').whereIn('id', variantIds).select('id', 'product_id', 'cost_price', 'packaging_cost', 'platform_fee_percent');
      const variantMap = new Map(variants.map(v => [v.id, v]));
      const productIds = [...new Set(variants.map(v => v.product_id))];
      const componentsByProduct = new Map<string, Array<any>>();
      for (const row of await costRepository.getComponentsByProductIds(productIds)) {
        if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
        componentsByProduct.get(row.product_id)!.push({
          id: row.id, name: row.name, type: row.type, category: row.category,
          value: Number(row.value), calculation_base: row.calculation_base, quantity: row.quantity,
        });
      }

      const engineItems: CostEngineItemInput[] = items.map(item => {
        const v = variantMap.get(item.variant_id);
        if (!v) throw new Error(`Product variant ${item.variant_id} not found`);
        return {
          variant_id: item.variant_id,
          product_id: v.product_id,
          unit_price: item.unit_price,
          quantity: item.quantity,
          product_cost: Number(v.cost_price || 0),
          legacy_packaging_cost: Number(v.packaging_cost || 0),
          legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
          components: (componentsByProduct.get(v.product_id) || []).map((c: any) => ({ ...c, type: c.type as any, category: c.category as any, calculation_base: c.calculation_base as any })),
        };
      });

      const costResult = computeOrderCosts(engineItems, { shipping_cost_owner: 0, discount_amount: 0 });

      const insertedItems = await trx(this.itemsTable)
        .insert(items.map((item, idx) => applySnapshot({ ...item, order_id: order.id }, costResult.items[idx]!)))
        .returning('*');

      for (const item of items) {
        const variant = await trx('product_variants')
          .where({ id: item.variant_id })
          .forUpdate()
          .first();

        if (!variant) {
          throw new Error(`Product variant ${item.variant_id} not found`);
        }

        if (variant.stock_quantity < item.quantity) {
          throw new Error(
            `Insufficient stock for variant ${item.variant_id}. Available: ${variant.stock_quantity}, requested: ${item.quantity}`
          );
        }

        await trx('product_variants')
          .where({ id: item.variant_id })
          .update({
            stock_quantity: variant.stock_quantity - item.quantity,
            updated_at: new Date(),
          });

        await trx('inventory_transactions')
          .insert({
            variant_id: item.variant_id,
            order_id: order.id,
            quantity_changed: -item.quantity,
            type: 'SALE',
          });
      }

      await trx(this.ordersTable)
        .where({ id: order.id })
        .update({
          total_cost: costResult.total_cost,
          total_profit: costResult.total_profit,
          margin_percent: costResult.margin_percent,
          updated_at: new Date(),
        });

      return {
        ...order,
        total_cost: costResult.total_cost,
        total_profit: costResult.total_profit,
        margin_percent: costResult.margin_percent,
        updated_at: new Date(),
        items: insertedItems,
      };
    });
  }

  async upsertOrderFromNuvemshop(data: NuvemshopOrderData): Promise<OrderWithItems> {
    return await db.transaction(async (trx) => {
      const { id: nuvemshop_order_id, customer, status, total, items: nuvemshopItems } = data;

      // 1. Find or create the order
      let order: Order | undefined;
      const existingOrder = await trx(this.ordersTable)
        .where({ nuvemshop_order_id })
        .first();

      const orderUpsertData = {
        customer_name: customer.name,
        status,
        total_amount: total,
        updated_at: new Date(),
        discount_amount: data.discount ? parseFloat(data.discount) : null,
        shipping_cost_customer: data.shipping_cost_customer
          ? parseFloat(data.shipping_cost_customer)
          : null,
        shipping_cost_owner: data.shipping_cost_owner
          ? parseFloat(data.shipping_cost_owner)
          : null,
        payment_status: data.payment_status || null,
        fulfillment_status: data.fulfillments?.[0]?.status || null,
        has_free_shipping: data.free_shipping_config?.cart_has_free_shipping ?? null,
        paid_at: data.paid_at ? new Date(data.paid_at) : null,
        shipped_at: data.shipped_at ? new Date(data.shipped_at) : null,
        completed_at: data.completed_at?.date
          ? new Date(data.completed_at.date)
          : null,
        cancelled_at: data.cancelled_at ? new Date(data.cancelled_at) : null,
        payment_method: data.payment_details?.method || null,
        payment_installments: data.payment_details?.installments != null
          ? data.payment_details.installments
          : null,
        gateway: data.gateway || null,
        shipping_city: data.shipping_address?.city || null,
        shipping_province: data.shipping_address?.province || null,
        shipping_carrier: data.shipping_carrier_name || null,
        utm_source: data.customer_visit?.utm_parameters?.utm_source || null,
        utm_medium: data.customer_visit?.utm_parameters?.utm_medium || null,
        utm_campaign: data.customer_visit?.utm_parameters?.utm_campaign || null,
        utm_content: data.customer_visit?.utm_parameters?.utm_content || null,
        utm_term: data.customer_visit?.utm_parameters?.utm_term || null,
        storefront: data.storefront || null,
        customer_email: data.contact_email || null,
      };

      if (existingOrder) {
        [order] = await trx(this.ordersTable)
          .where({ id: existingOrder.id })
          .update(orderUpsertData)
          .returning('*');
      } else {
        [order] = await trx(this.ordersTable)
          .insert({
            nuvemshop_order_id,
            ...orderUpsertData,
            updated_at: undefined,
          })
          .returning('*');
      }

      if (!order) {
        throw new Error('Failed to create or update order.');
      }

      // 2. Process order items
      const nuvemshopVariantIds = nuvemshopItems.map(item => item.variant_id);
      const internalVariants = await trx('product_variants')
        .whereIn('nuvemshop_variant_id', nuvemshopVariantIds)
        .select('id', 'nuvemshop_variant_id', 'product_id', 'cost_price', 'packaging_cost', 'platform_fee_percent');

      const variantMap = new Map(internalVariants.map(v => [v.nuvemshop_variant_id, v]));

      const productIds = [...new Set(internalVariants.map(v => v.product_id))];
      const componentsByProduct = new Map<string, Array<{ id: string; name: string; type: string; category: string; value: number; calculation_base: string; quantity: number }>>();
      for (const row of await costRepository.getComponentsByProductIds(productIds)) {
        if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
        componentsByProduct.get(row.product_id)!.push({
          id: row.id, name: row.name, type: row.type, category: row.category,
          value: Number(row.value), calculation_base: row.calculation_base, quantity: row.quantity,
        });
      }

      const engineItems: CostEngineItemInput[] = [];
      for (const nuvemshopItem of nuvemshopItems) {
        const internalVariant = variantMap.get(nuvemshopItem.variant_id);
        if (!internalVariant) continue;
        engineItems.push({
          variant_id: internalVariant.id,
          product_id: internalVariant.product_id,
          unit_price: nuvemshopItem.price,
          quantity: nuvemshopItem.quantity,
          product_cost: Number(internalVariant.cost_price || 0),
          legacy_packaging_cost: Number(internalVariant.packaging_cost || 0),
          legacy_platform_fee_percent: Number(internalVariant.platform_fee_percent || 0),
          components: (componentsByProduct.get(internalVariant.product_id) || []).map(c => ({
            ...c, type: c.type as any, category: c.category as any, calculation_base: c.calculation_base as any,
          })),
        });
      }

      const costResult = computeOrderCosts(engineItems, {
        shipping_cost_owner: data.shipping_cost_owner ? parseFloat(data.shipping_cost_owner) : 0,
        discount_amount: data.discount ? parseFloat(data.discount) : 0,
      });
      // Freeze the cost columns of previously-synced items so re-syncs do not
      // recompute them from the current component config.
      const frozenByVariant = new Map<string, any>();
      if (existingOrder) {
        const prevItems = await trx(this.itemsTable).where({ order_id: order.id, status: true });
        for (const pi of prevItems) frozenByVariant.set(pi.variant_id, pi);
      }
      // Deactivate existing items to handle updates/removals
      await trx(this.itemsTable)
        .where({ order_id: order.id })
        .update({ status: false });

      const processedItems: OrderItem[] = [];
      let engineIdx = 0;
      for (const nuvemshopItem of nuvemshopItems) {
        const internalVariant = variantMap.get(nuvemshopItem.variant_id);
        if (!internalVariant) {
          console.warn(`Skipping order item because variant with nuvemshop_variant_id ${nuvemshopItem.variant_id} was not found in the database.`);
          continue;
        }

        const snapshot = costResult.items[engineIdx]!;
        engineIdx++;
        const base = applySnapshot({
          order_id: order.id,
          variant_id: internalVariant.id,
          quantity: nuvemshopItem.quantity,
          unit_price: nuvemshopItem.price,
          has_promotional_price: nuvemshopItem.has_promotional_price ?? null,
          status: true,
        }, snapshot);
        const frozen = frozenByVariant.get(internalVariant.id);
        if (frozen) {
          Object.assign(base, {
            unit_cost: frozen.unit_cost,
            unit_packaging_cost: frozen.unit_packaging_cost,
            unit_platform_fee: frozen.unit_platform_fee,
            unit_tax: frozen.unit_tax,
            unit_shipping_cost: frozen.unit_shipping_cost,
            unit_operational_cost: frozen.unit_operational_cost,
            unit_marketing_cost: frozen.unit_marketing_cost,
            unit_other_cost: frozen.unit_other_cost,
            unit_total_cost: frozen.unit_total_cost,
            unit_profit: frozen.unit_profit,
            margin_percent: frozen.margin_percent,
            cost_breakdown: JSON.stringify(frozen.cost_breakdown),
          });
        }
        const [item] = await trx(this.itemsTable)
          .insert(base)
          .returning('*');
        processedItems.push(item);
      }

      const insertedForTotals = await trx(this.itemsTable).where({ order_id: order.id, status: true });
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const total_cost = round2(insertedForTotals.reduce((s, i) => s + Number(i.unit_total_cost) * i.quantity, 0));
      const netRevenue = Number(order.total_amount) - (order.discount_amount ? Number(order.discount_amount) : 0);
      const total_profit = round2(netRevenue - total_cost);
      const margin_percent = netRevenue > 0 ? round2((total_profit / netRevenue) * 100) : 0;
      await trx(this.ordersTable).where({ id: order.id }).update({ total_cost, total_profit, margin_percent, updated_at: new Date() });

      return { ...order, total_cost, total_profit, margin_percent, updated_at: new Date(), items: processedItems };
    });
  }

  /**
   * FIND BY ID
   */
  async findById(id: string): Promise<OrderWithItems | null> {
    const order = await db(this.ordersTable)
      .where({ id })
      .whereNull('deleted_at')
      .first();

    if (!order) return null;

    const items = await db(this.itemsTable)
      .where({ order_id: id, status: true });

    return {
      ...order,
      items
    };
  }

  async findByNuvemshopOrderId(nuvemshopOrderId: string): Promise<Order | null> {
    return db(this.ordersTable).where({ nuvemshop_order_id: nuvemshopOrderId }).first();
  }

  /**
   * FIND
   */
  async findAll(
    page: number = 1,
    limit: number = 10,
    filters: { status?: string; search?: string } = {}
  ): Promise<{ orders: OrderWithItems[]; total: number; page: number; limit: number }> {
    let query = db(this.ordersTable)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    if (filters.status) {
      query = query.where('status', filters.status);
    }

    if (filters.search) {
      query = query.where((builder: Knex.QueryBuilder) => {
        builder.where('customer_name', 'ilike', `%${filters.search}%`)
          .orWhere('nuvemshop_order_id', 'ilike', `%${filters.search}%`);
      });
    }

    const totalQuery = query.clone().clearOrder().clearSelect().count('* as count');
    const totalResult = await totalQuery.first();
    const total = Number(totalResult?.count || 0);

    const offset = (page - 1) * limit;
    const baseOrders = await query.limit(limit).offset(offset);

    const ordersWithItems = await Promise.all(
      baseOrders.map(async (order) => {
        const items = await db(this.itemsTable)
          .where({ order_id: order.id, status: true });
        return { ...order, items };
      })
    );

    return {
      orders: ordersWithItems,
      total,
      page,
      limit,
    };
  }

  /**
   * UPDATE
   */
  async update(id: string, data: UpdateOrderInput): Promise<OrderWithItems | null> {
    const [updatedOrder] = await db(this.ordersTable)
      .where({ id })
      .whereNull('deleted_at')
      .update({
        ...data,
        updated_at: new Date()
      })
      .returning('*');

    if (!updatedOrder) return null;

    return this.findById(id);
  }

  /**
   * SOFT DELETE
   */
  async delete(id: string): Promise<boolean> {
    return await db.transaction(async (trx) => {
      await trx(this.itemsTable)
        .where({ order_id: id })
        .update({
          status: false,
          updated_at: new Date()
        });

      const result = await trx(this.ordersTable)
        .where({ id })
        .update({
          deleted_at: new Date(),
          updated_at: new Date(),
          status: 'CANCELED'
        });

      return result > 0;
    });
  }
}

export const orderRepository = new OrderRepository();
