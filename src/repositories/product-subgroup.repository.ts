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
    return await db.transaction(async (trx) => {
      const result = await trx(this.table)
        .where({ id }).whereNull('deleted_at')
        .update({ deleted_at: new Date(), is_active: false, updated_at: new Date() });
      if (result > 0) {
        await trx('products')
          .where({ subgroup_id: id })
          .whereNull('deleted_at')
          .update({ subgroup_id: null, updated_at: new Date() });
      }
      return result > 0;
    });
  }

  async assignProducts(subgroupId: string, productIds: string[]) {
    const result = await db('products')
      .whereIn('id', productIds)
      .whereNull('deleted_at')
      .update({ subgroup_id: subgroupId, updated_at: new Date() });
    return result;
  }

  async unassignProduct(subgroupId: string, productId: string) {
    const result = await db('products')
      .where({ id: productId, subgroup_id: subgroupId })
      .whereNull('deleted_at')
      .update({ subgroup_id: null, updated_at: new Date() });
    return result > 0;
  }

  async listProducts(subgroupId: string, page: number, limit: number, search?: string) {
    let query = db('products')
      .where({ subgroup_id: subgroupId })
      .whereNull('deleted_at');

    if (search) {
      const term = `%${search}%`;
      query = query.where((builder: any) => {
        builder.where('name', 'ilike', term)
          .orWhere('slug', 'ilike', term)
          .orWhereExists(function (this: any) {
            this.select('id')
              .from('product_variants')
              .whereRaw('product_variants.product_id = products.id')
              .whereNull('product_variants.deleted_at')
              .where((b: any) => {
                b.where('product_variants.sku', 'ilike', term)
                  .orWhere('product_variants.name', 'ilike', term);
              });
          });
      });
    }

    const totalResult = await query.clone().count('* as count').first();
    const total = Number(totalResult?.count || 0);

    const offset = (page - 1) * limit;
    const baseProducts = await query
      .clone()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const products = await Promise.all(
      baseProducts.map(async (product) => {
        const variants = await db('product_variants')
          .where({ product_id: product.id })
          .whereNull('deleted_at');
        return { ...product, variants };
      })
    );

    return { products, total, page, limit };
  }
}

export const productSubgroupRepository = new ProductSubgroupRepository();
