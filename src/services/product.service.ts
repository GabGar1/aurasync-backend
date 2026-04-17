import {
  productRepository,
  type ProductWithVariants,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateVariantInput // <-- Adicionado para o TypeScript parar de chorar
} from '../repositories/product.repository.js';
import { ProductSchema, type ProductCreate, type ProductUpdate } from '../schemas/product.schema.js';

export class ProductService {

  async createProduct(productData: ProductCreate): Promise<ProductWithVariants> {
    const validatedData = ProductSchema.create.parse(productData);

    const existingProduct = await productRepository.findBySlug(validatedData.slug);
    if (existingProduct) {
      throw new Error('A product with this slug already exists');
    }

    const createInput: CreateProductInput = {
      slug: validatedData.slug,
      name: validatedData.name,
      variants: validatedData.variants.map(variant => {
        const v: CreateVariantInput = {
          price: variant.price,
          stock_quantity: variant.stock_quantity,
        };

        if (variant.nuvemshop_variant_id !== undefined) v.nuvemshop_variant_id = variant.nuvemshop_variant_id;
        if (variant.sku !== undefined) v.sku = variant.sku;
        if (variant.name !== undefined) v.name = variant.name;
        if (variant.cost_price !== undefined) v.cost_price = variant.cost_price;
        if (variant.packaging_cost !== undefined) v.packaging_cost = variant.packaging_cost;
        if (variant.platform_fee_percent !== undefined) v.platform_fee_percent = variant.platform_fee_percent;
        if (variant.fixed_fee !== undefined) v.fixed_fee = variant.fixed_fee;

        return v;
      }),
    };

    if (validatedData.nuvemshop_id !== undefined) createInput.nuvemshop_id = validatedData.nuvemshop_id;
    if (validatedData.category !== undefined) createInput.category = validatedData.category;
    if (validatedData.is_active !== undefined) createInput.is_active = validatedData.is_active;
    else createInput.is_active = true; // Fallback para true

    return await productRepository.create(createInput);
  }

  async getProductById(id: string): Promise<ProductWithVariants | null> {
    return await productRepository.findById(id);
  }

  async getProductBySlug(slug: string): Promise<ProductWithVariants | null> {
    return await productRepository.findBySlug(slug);
  }

  async updateProduct(id: string, productData: ProductUpdate): Promise<ProductWithVariants | null> {
    const validatedData = ProductSchema.update.parse(productData);

    const existingProduct = await productRepository.findById(id);
    if (!existingProduct) {
      throw new Error('Product not found');
    }

    if (validatedData.slug && validatedData.slug !== existingProduct.slug) {
      const slugConflict = await productRepository.findBySlug(validatedData.slug);
      if (slugConflict) {
        throw new Error('A product with this new slug already exists');
      }
    }

    const updateData: UpdateProductInput = {};
    if (validatedData.slug !== undefined) updateData.slug = validatedData.slug;
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.category !== undefined) updateData.category = validatedData.category;
    if (validatedData.is_active !== undefined) updateData.is_active = validatedData.is_active;

    return await productRepository.update(id, updateData);
  }

  async findByNuvemshopId(nuvemshopId: string) {
    return await productRepository.findByNuvemshopId(nuvemshopId);
  }

  async deleteProduct(id: string): Promise<boolean> {
    const existingProduct = await productRepository.findById(id);
    if (!existingProduct) {
      throw new Error('Product not found');
    }

    return await productRepository.delete(id);
  }

  async getProducts(
    page: number = 1,
    limit: number = 10,
    filters: { search?: string; category?: string; is_active?: boolean } = {}
  ): Promise<{ products: ProductWithVariants[]; total: number; page: number; limit: number }> {
    return await productRepository.findAll(page, limit, filters);
  }
}

export const productService = new ProductService();