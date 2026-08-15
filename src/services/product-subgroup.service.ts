import { productSubgroupRepository } from '../repositories/product-subgroup.repository.js';
import { ProductSubgroupSchema, type ProductSubgroupCreate, type ProductSubgroupUpdate } from '../schemas/product-subgroup.schema.js';

export class ProductSubgroupService {
  async listSubgroups(filter: { is_active?: boolean; search?: string } = {}) {
    return productSubgroupRepository.list(filter);
  }

  async createSubgroup(data: ProductSubgroupCreate) {
    const v = ProductSubgroupSchema.create.parse(data);
    return productSubgroupRepository.create({
      name: v.name,
      description: v.description ?? null,
      is_active: v.is_active ?? true,
    });
  }

  async updateSubgroup(id: string, data: ProductSubgroupUpdate) {
    const v = ProductSubgroupSchema.update.parse(data);
    const existing = await productSubgroupRepository.findById(id);
    if (!existing) throw new Error('Subgroup not found');
    return productSubgroupRepository.update(id, v);
  }

  async deleteSubgroup(id: string) {
    const existing = await productSubgroupRepository.findById(id);
    if (!existing) throw new Error('Subgroup not found');
    return productSubgroupRepository.softDelete(id);
  }

  async assignProductsToSubgroup(subgroupId: string, productIds: string[]) {
    const v = ProductSubgroupSchema.assignProducts.parse({ product_ids: productIds });
    const existing = await productSubgroupRepository.findById(subgroupId);
    if (!existing) throw new Error('Subgroup not found');
    const count = await productSubgroupRepository.assignProducts(subgroupId, v.product_ids);
    return { assigned: count };
  }

  async listProducts(subgroupId: string, page: number, limit: number, search?: string) {
    const existing = await productSubgroupRepository.findById(subgroupId);
    if (!existing) throw new Error('Subgroup not found');
    return productSubgroupRepository.listProducts(subgroupId, page, limit, search);
  }

  async unassignProduct(subgroupId: string, productId: string) {
    const existing = await productSubgroupRepository.findById(subgroupId);
    if (!existing) throw new Error('Subgroup not found');
    return productSubgroupRepository.unassignProduct(subgroupId, productId);
  }
}

export const productSubgroupService = new ProductSubgroupService();
