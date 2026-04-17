import { inventoryRepository, type CreateInventoryInput } from '../repositories/inventory.repository.js';
import { InventorySchema, type InventoryCreate } from '../schemas/inventory.schema.js';

export class InventoryService {

  async addTransaction(data: InventoryCreate) {
    const validatedData = InventorySchema.create.parse(data);

    if (validatedData.type === 'SALE' && validatedData.quantity_changed > 0) {
      throw new Error('SALE transactions must have a negative quantity_changed');
    }
    if (validatedData.type === 'RESTOCK' && validatedData.quantity_changed < 0) {
      throw new Error('RESTOCK transactions must have a positive quantity_changed');
    }

    const input: CreateInventoryInput = {
      variant_id: validatedData.variant_id,
      type: validatedData.type as 'SALE' | 'RESTOCK' | 'ADJUSTMENT',
      quantity_changed: validatedData.quantity_changed,
    };

    if (validatedData.order_id !== undefined) {
      input.order_id = validatedData.order_id;
    }

    return await inventoryRepository.createTransaction(input);
  }

  async getVariantHistory(variantId: string) {
    if (!variantId) {
      throw new Error('Variant ID is required');
    }
    return await inventoryRepository.getHistoryByVariantId(variantId);
  }

  async getGlobalHistory(page: number = 1, limit: number = 50) {
    return await inventoryRepository.getAllHistory(page, limit);
  }
}

export const inventoryService = new InventoryService();