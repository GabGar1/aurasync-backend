import { db } from '../lib/db.js';
import type { Knex } from 'knex';

export interface Product {
  id: string;
  nuvemshop_id: string | null;
  slug: string;
  name: string;
  category: string | null;
  is_active: boolean;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  nuvemshop_variant_id: string | null;
  sku: string | null;
  name: string | null;
  price: number;
  stock_quantity: number;
  cost_price: number;
  packaging_cost: number;
  platform_fee_percent: number;
  fixed_fee: number;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductWithVariants extends Product {
  variants: ProductVariant[];
}

export interface CreateVariantInput {
  nuvemshop_variant_id?: string;
  sku?: string;
  name?: string;
  price: number;
  stock_quantity: number;
  cost_price?: number;
  packaging_cost?: number;
  platform_fee_percent?: number;
  fixed_fee?: number;
}

export interface CreateProductInput {
  nuvemshop_id?: string;
  slug: string;
  name: string;
  category?: string;
  is_active?: boolean;
  variants: CreateVariantInput[];
}

export interface UpdateProductInput {
  slug?: string;
  name?: string;
  category?: string;
  is_active?: boolean;
}

export class ProductRepository {
  private productsTable = 'products';
  private variantsTable = 'product_variants';

  async findById(id: string): Promise<ProductWithVariants | null> {
    const product = await db(this.productsTable)
      .where({ id })
      .whereNull('deleted_at')
      .first();

    if (!product) return null;

    const variants = await db(this.variantsTable)
      .where({ product_id: id })
      .whereNull('deleted_at');

    return {
      ...product,
      variants,
    };
  }

  async findBySlug(slug: string): Promise<ProductWithVariants | null> {
    const product = await db(this.productsTable)
      .where({ slug })
      .whereNull('deleted_at')
      .first();

    if (!product) return null;

    const variants = await db(this.variantsTable)
      .where({ product_id: product.id })
      .whereNull('deleted_at');

    return {
      ...product,
      variants,
    };
  }

  async create(data: CreateProductInput): Promise<ProductWithVariants> {
    const { variants, ...productData } = data;

    // Abrindo a transação: Se a variação falhar, o produto inteiro sofre rollback
    return await db.transaction(async (trx) => {
      // 1. Cria o Produto
      const [product] = await trx(this.productsTable)
        .insert(productData)
        .returning('*');

      // 2. Prepara as variações com o ID gerado do Produto
      const variantsToInsert = variants.map(variant => ({
        ...variant,
        product_id: product.id,
      }));

      // 3. Insere todas as variações em Bulk (de uma vez só)
      const insertedVariants = await trx(this.variantsTable)
        .insert(variantsToInsert)
        .returning('*');

      return {
        ...product,
        variants: insertedVariants,
      };
    });
  }

  async update(id: string, data: UpdateProductInput): Promise<ProductWithVariants | null> {
    const [product] = await db(this.productsTable)
      .where({ id })
      .whereNull('deleted_at')
      .update({
        ...data,
        updated_at: new Date(),
      })
      .returning('*');

    if (!product) return null;

    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    // Soft delete em cascata manual usando transaction
    return await db.transaction(async (trx) => {
      // Deleta logicamente as variações primeiro
      await trx(this.variantsTable)
        .where({ product_id: id })
        .whereNull('deleted_at')
        .update({
          deleted_at: new Date(),
          updated_at: new Date(),
        });

      // Deleta logicamente o produto
      const result = await trx(this.productsTable)
        .where({ id })
        .whereNull('deleted_at')
        .update({
          deleted_at: new Date(),
          updated_at: new Date(),
          is_active: false,
        });

      return result > 0;
    });
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    filters: {
      search?: string;
      category?: string;
      is_active?: boolean;
    } = {}
  ): Promise<{ products: ProductWithVariants[]; total: number; page: number; limit: number }> {
    let query = db(this.productsTable)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    if (filters.category) {
      query = query.where('category', filters.category);
    }

    if (filters.is_active !== undefined) {
      query = query.where('is_active', filters.is_active);
    }

    if (filters.search) {
      query = query.where((builder: Knex.QueryBuilder) => {
        builder.where('name', 'ilike', `%${filters.search}%`)
          .orWhere('slug', 'ilike', `%${filters.search}%`)
          .orWhere('nuvemshop_id', 'ilike', `%${filters.search}%`);
      });
    }

    const totalQuery = query.clone().clearOrder().clearSelect().count('* as count');
    const totalResult = await totalQuery.first();
    const total = Number(totalResult?.count || 0);

    const offset = (page - 1) * limit;
    const baseProducts = await query.limit(limit).offset(offset);

    // Busca as variações de todos os produtos listados
    const products = await Promise.all(
      baseProducts.map(async (product) => {
        const variants = await db(this.variantsTable)
          .where({ product_id: product.id })
          .whereNull('deleted_at');
        return { ...product, variants };
      })
    );

    return {
      products,
      total,
      page,
      limit,
    };
  }
}

export const productRepository = new ProductRepository();