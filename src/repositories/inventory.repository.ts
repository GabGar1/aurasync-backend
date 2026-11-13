import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { db } from '../lib/db.js';

export interface InventoryTransaction {
  id: string;
  variant_id: string;
  order_id: string | null;
  type: string;
  quantity_changed: number;
  status: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateInventoryInput {
  variant_id: string;
  order_id?: string | null;
  type: 'SALE' | 'RESTOCK' | 'ADJUSTMENT';
  quantity_changed: number;
}

export interface InventoryHistoryFilters {
  type?: 'SALE' | 'RESTOCK' | 'ADJUSTMENT';
  /** Product name or SKU. */
  search?: string;
}

export class InventoryRepository {
  private table = 'inventory_transactions';

  async createTransaction(data: CreateInventoryInput): Promise<InventoryTransaction> {
    return await db.transaction(async (trx) => {
      const variant = await trx('product_variants')
        .where({ id: data.variant_id })
        .forUpdate()
        .first();

      if (!variant) {
        throw new NotFoundError('Product variant not found');
      }

      const newStock = variant.stock_quantity + data.quantity_changed;

      if (newStock < 0) {
        throw new BadRequestError('Insufficient stock for this transaction');
      }

      await trx('product_variants')
        .where({ id: data.variant_id })
        .update({
          stock_quantity: newStock,
          updated_at: new Date()
        });

      const [transaction] = await trx(this.table)
        .insert(data)
        .returning('*');

      return transaction;
    });
  }

  async getHistoryByVariantId(variant_id: string): Promise<InventoryTransaction[]> {
    return await db(this.table)
      .where({ variant_id })
      .orderBy('created_at', 'desc');
  }

  /**
   * Movements with product/variant names, filtered by type and by product name or SKU,
   * plus a summary of everything that matches (not only the current page).
   */
  async getAllHistory(page: number = 1, limit: number = 50, filters: InventoryHistoryFilters = {}) {
    let query = db(this.table)
      .join('product_variants', `${this.table}.variant_id`, 'product_variants.id')
      .join('products', 'products.id', 'product_variants.product_id');

    if (filters.type) query = query.where(`${this.table}.type`, filters.type);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.where((b) => {
        b.where('products.name', 'ilike', term).orWhere('product_variants.sku', 'ilike', term);
      });
    }

    const summaryRow = (await query
      .clone()
      .select(
        db.raw(`COALESCE(SUM(CASE WHEN ${this.table}.quantity_changed > 0 THEN ${this.table}.quantity_changed ELSE 0 END), 0)::int as entries`),
        db.raw(`COALESCE(SUM(CASE WHEN ${this.table}.quantity_changed < 0 THEN -${this.table}.quantity_changed ELSE 0 END), 0)::int as exits`),
        db.raw('COUNT(*)::int as movements')
      )
      .first()) as { entries: number; exits: number; movements: number } | undefined;

    const transactions = await query
      .clone()
      .select(
        `${this.table}.*`,
        'products.name as product_name',
        'product_variants.name as variant_name',
        'product_variants.sku as sku'
      )
      .orderBy(`${this.table}.created_at`, 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    const summary = {
      entries: Number(summaryRow?.entries ?? 0),
      exits: Number(summaryRow?.exits ?? 0),
      movements: Number(summaryRow?.movements ?? 0),
    };
    return { transactions, total: summary.movements, page, limit, summary };
  }
}

export const inventoryRepository = new InventoryRepository();