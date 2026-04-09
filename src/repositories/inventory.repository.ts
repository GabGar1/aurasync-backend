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

export class InventoryRepository {
  private table = 'inventory_transactions';

  async createTransaction(data: CreateInventoryInput): Promise<InventoryTransaction> {
    return await db.transaction(async (trx) => {
      const variant = await trx('product_variants')
        .where({ id: data.variant_id })
        .first();

      if (!variant) {
        throw new Error('Product variant not found');
      }

      // A mágica matemática: Como quantity_changed é negativo na saída,
      // usar a soma (+) já resolve a matemática. Ex: 10 + (-3) = 7
      const newStock = variant.stock_quantity + data.quantity_changed;

      if (newStock < 0) {
        throw new Error('Insufficient stock for this transaction');
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
}

export const inventoryRepository = new InventoryRepository();