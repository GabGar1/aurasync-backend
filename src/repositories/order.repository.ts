import { db } from '../lib/db.js';
import type { Knex } from 'knex';

// --- INTERFACES ---

export interface Order {
  id: string;
  nuvemshop_order_id: string | null;
  customer_name: string | null;
  status: string;
  total_amount: number;
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
  status: boolean;
  created_at: Date;
  updated_at: Date;
}

// O Pedido Completo (Pai + Filhos)
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

export interface UpdateOrderInput {
  customer_name?: string;
  status?: string;
}

// --- REPOSITORY ---

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

      const itemsToInsert = items.map(item => ({
        ...item,
        order_id: order.id
      }));

      const insertedItems = await trx(this.itemsTable)
        .insert(itemsToInsert)
        .returning('*');

      return {
        ...order,
        items: insertedItems
      };
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