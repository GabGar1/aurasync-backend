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
  has_promotional_price: boolean | null;
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
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
  has_promotional_price?: boolean;
  weight?: number;
  height?: number;
  width?: number;
  depth?: number;
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

export interface NuvemshopVariantData {
  id: string;
  sku?: string;
  name?: string;
  price: number;
  stock_quantity: number;
  cost_price?: number;
  packaging_cost?: number;
  platform_fee_percent?: number;
  fixed_fee?: number;
  has_promotional_price?: boolean;
  weight?: number;
  height?: number;
  width?: number;
  depth?: number;
}

export interface NuvemshopProductData {
  id: string; // Nuvemshop's product ID
  name: string;
  category?: string;
  is_active: boolean;
  variants: NuvemshopVariantData[];
}

export class ProductRepository {
  private productsTable = 'products';
  private variantsTable = 'product_variants';

  async findById(id: string): Promise<ProductWithVariants | null> {
    const product = await db(this.productsTable)
        .where({id})
        .whereNull('deleted_at')
        .first();

    if (!product) return null;

    const variants = await db(this.variantsTable)
        .where({product_id: id})
        .whereNull('deleted_at');

    return {
      ...product,
      variants,
    };
  }

  async findBySlug(slug: string): Promise<ProductWithVariants | null> {
    const product = await db(this.productsTable)
        .where({slug})
        .whereNull('deleted_at')
        .first();

    if (!product) return null;

    const variants = await db(this.variantsTable)
        .where({product_id: product.id})
        .whereNull('deleted_at');

    return {
      ...product,
      variants,
    };
  }

  async create(data: CreateProductInput): Promise<ProductWithVariants> {
    const {variants, ...productData} = data;

    return await db.transaction(async (trx) => {
      const [product] = await trx(this.productsTable)
          .insert(productData)
          .returning('*');

      const variantsToInsert = variants.map(variant => ({
        ...variant,
        product_id: product.id,
      }));

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
        .where({id})
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
    return await db.transaction(async (trx) => {
      await trx(this.variantsTable)
          .where({product_id: id})
          .whereNull('deleted_at')
          .update({
            deleted_at: new Date(),
            updated_at: new Date(),
          });

      const result = await trx(this.productsTable)
          .where({id})
          .whereNull('deleted_at')
          .update({
            deleted_at: new Date(),
            updated_at: new Date(),
            is_active: false,
          });

      return result > 0;
    });
  }

  async upsertProductFromNuvemshop(data: NuvemshopProductData): Promise<ProductWithVariants> {
    return await db.transaction(async (trx) => {
      const {id: nuvemshop_id, variants: nuvemshopVariants, ...productData} = data;

      let product: Product | undefined;
      const existingProduct = await trx(this.productsTable)
          .where({nuvemshop_id})
          .first();

      if (existingProduct) {
        // Update existing product
        [product] = await trx(this.productsTable)
            .where({id: existingProduct.id})
            .update({
              ...productData,
              updated_at: new Date(),
            })
            .returning('*');
      } else {
        // Create new product
        [product] = await trx(this.productsTable)
            .insert({
              nuvemshop_id,
              // Assuming a slug can be generated or is optional for creation
              // If slug is mandatory and not provided by Nuvemshop, you'll need to generate one here.
              slug: `${productData.name}-${nuvemshop_id}`, // Placeholder, adjust as needed
              ...productData,
            })
            .returning('*');
      }

      if (!product) {
        throw new Error('Failed to create or update product.');
      }

      const productInternalId = product.id;
      const existingVariants = await trx(this.variantsTable)
          .where({product_id: productInternalId})
          .whereNull('deleted_at');

      const updatedVariants: ProductVariant[] = [];

      for (const nuvemshopVariant of nuvemshopVariants) {
        const {id: nuvemshop_variant_id, ...variantData} = nuvemshopVariant;
        const existingVariant = existingVariants.find(v => v.nuvemshop_variant_id === nuvemshop_variant_id);

        if (existingVariant) {
          // Update existing variant
          const [updatedVariant] = await trx(this.variantsTable)
              .where({id: existingVariant.id})
              .update({
                ...variantData,
                updated_at: new Date(),
                deleted_at: null, // Ensure it's not marked as deleted if it reappears
              })
              .returning('*');
          updatedVariants.push(updatedVariant);
        } else {
          // Create new variant
          const [newVariant] = await trx(this.variantsTable)
              .insert({
                product_id: productInternalId,
                nuvemshop_variant_id,
                ...variantData,
              })
              .returning('*');
          updatedVariants.push(newVariant);
        }
      }

      return {...product, variants: updatedVariants};
    });
  }

  async findByNuvemshopId(nuvemshopId: string) {
    return await db(this.productsTable).where({nuvemshop_id: nuvemshopId}).first();
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

    let query = db(this.productsTable).whereNull('deleted_at');

    if (filters.category) {
      query = query.where('category', filters.category);
    }

    if (filters.is_active !== undefined) {
      query = query.where('is_active', filters.is_active);
    }

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.where((builder: Knex.QueryBuilder) => {
        builder.where('name', 'ilike', term)
          .orWhere('slug', 'ilike', term)
          .orWhere('nuvemshop_id', 'ilike', term)
          .orWhereExists(function (this: any) {
            this.select('id')
              .from('product_variants')
              .whereRaw('product_variants.product_id = products.id')
              .whereNull('product_variants.deleted_at')
              .where((b: any) => {
                b.where('product_variants.sku', 'ilike', term)
                  .orWhere('product_variants.name', 'ilike', term)
                  .orWhere('product_variants.nuvemshop_variant_id', 'ilike', term)
                  .orWhere(db.raw('product_variants.id::text'), 'ilike', term);
              });
          });
      });
    }

    const totalResult = await query.clone().count('* as count').first();
    const total = Number(totalResult?.count || 0);

    const offset = (page - 1) * limit;
    const baseProducts = await query
        .clone()
        .orderBy('is_active', 'desc')
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

    const products = await Promise.all(
        baseProducts.map(async (product) => {
          const variants = await db(this.variantsTable)
              .where({product_id: product.id})
              .whereNull('deleted_at');
          return {...product, variants};
        })
    );

    return {
      products,
      total,
      page,
      limit,
    };
  };
}

export const productRepository = new ProductRepository();