import { db } from '../lib/db.js';

export class ProductSubgroupRepository {
  private table = 'product_subgroups';

  async findById(id: string) {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  async list(filter: { is_active?: boolean; search?: string } = {}) {
    let q = db(this.table).whereNull('deleted_at').orderBy('name', 'asc');
    if (filter.is_active !== undefined) q = q.where('is_active', filter.is_active);
    if (filter.search) q = q.where('name', 'ilike', `%${filter.search}%`);
    return q;
  }

  async create(data: { name: string; description?: string | null; is_active: boolean }) {
    const [row] = await db(this.table).insert(data).returning('*');
    return row;
  }

  async update(id: string, data: { name?: string | undefined; description?: string | null | undefined; is_active?: boolean | undefined }) {
    const [row] = await db(this.table)
      .where({ id }).whereNull('deleted_at')
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return row || null;
  }

  async softDelete(id: string) {
    const result = await db(this.table)
      .where({ id }).whereNull('deleted_at')
      .update({ deleted_at: new Date(), is_active: false, updated_at: new Date() });
    return result > 0;
  }

  async assignProducts(subgroupId: string, productIds: string[]) {
    const result = await db('products')
      .whereIn('id', productIds)
      .whereNull('deleted_at')
      .update({ subgroup_id: subgroupId, updated_at: new Date() });
    return result;
  }
}

export const productSubgroupRepository = new ProductSubgroupRepository();
