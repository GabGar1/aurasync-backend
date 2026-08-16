import { db } from '../lib/db.js';

export interface UpsertCustomerInput {
  email: string | null;
  name: string;
  city?: string | null;
  province?: string | null;
  payment_method?: string | null;
  gateway?: string | null;
  storefront?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  total: number;
  date: Date;
}

export class CustomerRepository {
  private table = 'customers';

  async create(data: { name: string; email?: string | undefined; city?: string | undefined; province?: string | undefined }) {
    if (!data.email) {
      const [row] = await db(this.table)
        .insert({
          name: data.name,
          email: null,
          city: data.city ?? null,
          province: data.province ?? null,
          first_purchase_at: null,
          last_purchase_at: null,
        })
        .returning("*");
      return row;
    }

    const merge: Record<string, unknown> = {
      name: data.name,
      updated_at: new Date(),
    };
    if (data.city != null) merge.city = data.city;
    if (data.province != null) merge.province = data.province;

    const [row] = await db(this.table)
      .insert({
        name: data.name,
        email: data.email,
        city: data.city ?? null,
        province: data.province ?? null,
        first_purchase_at: null,
        last_purchase_at: null,
      })
      .onConflict("email")
      .merge(merge)
      .returning("*");
    return row;
  }

  async upsertFromOrder(data: UpsertCustomerInput) {
    if (!data.email) {
      return null;
    }

    const merge: Record<string, unknown> = {
      name: data.name,
      last_purchase_at: data.date,
      updated_at: new Date(),
    };
    if (data.city != null) merge.city = data.city;
    if (data.province != null) merge.province = data.province;

    const [row] = await db(this.table)
      .insert({
        email: data.email,
        name: data.name,
        city: data.city ?? null,
        province: data.province ?? null,
        origin: data.storefront ?? null,
        utm_source: data.utm_source ?? null,
        utm_medium: data.utm_medium ?? null,
        utm_campaign: data.utm_campaign ?? null,
        first_purchase_at: data.date,
        last_purchase_at: data.date,
      })
      .onConflict("email")
      .merge(merge)
      .returning("*");

    return row;
  }

  async findAll(page = 1, limit = 20, filters: { search?: string } = {}) {
    let query = db(this.table).whereNull('deleted_at');

    if (filters.search) {
      query = query.where((b) => {
        b.where('name', 'ilike', `%${filters.search}%`)
          .orWhere('email', 'ilike', `%${filters.search}%`);
      });
    }

    const totalResult = await query.clone().count('* as count').first();
    const total = Number(totalResult?.count || 0);
    const offset = (page - 1) * limit;

    const customers = await query
      .clone()
      .select(
        `${this.table}.*`,
        db.raw(`(
          SELECT COUNT(*) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        )::int as order_count`),
        db.raw(`COALESCE((
          SELECT SUM(o.total_amount) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        ), 0)::float8 as total_spent`),
        db.raw(`COALESCE((
          SELECT AVG(o.total_amount) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        ), 0)::float8 as average_ticket`),
        db.raw(`(
          SELECT COUNT(*) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        )::int as recurrence`)
      )
      .orderBy('last_purchase_at', 'desc')
      .limit(limit)
      .offset(offset);

    return { customers, total, page, limit };
  }

  async findById(id: string) {
    const customer = await db(this.table).where({ id }).whereNull('deleted_at').first();
    if (!customer) return null;
    return customer;
  }

  async findOrders(customerId: string) {
    const customer = await this.findById(customerId);
    if (!customer) return null;
    if (!customer.email) return [];

    return db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .orderBy('created_at', 'desc');
  }

  async getIndicators(customerId: string) {
    const customer = await this.findById(customerId);
    if (!customer) return null;
    if (!customer.email) {
      return {
        order_count: 0, total_spent: 0, average_ticket: 0,
        first_purchase_at: customer.first_purchase_at,
        last_purchase_at: customer.last_purchase_at,
        favorite_payment_method: null, favorite_gateway: null, recurrence: 0,
      };
    }

    const stats = await db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .select(
        db.raw('COUNT(*)::int as order_count'),
        db.raw('COALESCE(SUM(total_amount),0)::float8 as total_spent'),
        db.raw('COALESCE(AVG(total_amount),0)::float8 as average_ticket'),
        db.raw('MIN(created_at) as first_purchase_at'),
        db.raw('MAX(created_at) as last_purchase_at')
      )
      .first();

    const favMethod = await db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .whereNotNull('payment_method')
      .groupBy('payment_method')
      .select('payment_method', db.raw('COUNT(*)::int as cnt'))
      .orderBy('cnt', 'desc')
      .first();

    const favGateway = await db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .whereNotNull('gateway')
      .groupBy('gateway')
      .select('gateway', db.raw('COUNT(*)::int as cnt'))
      .orderBy('cnt', 'desc')
      .first();

    return {
      order_count: Number(stats?.order_count || 0),
      total_spent: Number(stats?.total_spent || 0),
      average_ticket: Number(stats?.average_ticket || 0),
      first_purchase_at: stats?.first_purchase_at ?? null,
      last_purchase_at: stats?.last_purchase_at ?? null,
      favorite_payment_method: favMethod?.payment_method ?? null,
      favorite_gateway: favGateway?.gateway ?? null,
      recurrence: Number(stats?.order_count || 0) > 1 ? 1 : 0,
    };
  }
}

export const customerRepository = new CustomerRepository();
