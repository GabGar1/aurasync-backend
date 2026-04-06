import type { FastifyPluginAsync } from 'fastify';
import { productService } from '../services/product.service.js';

export const productRoutes: FastifyPluginAsync = async (fastify) => {

  // 1. CREATE: POST /api/products
  fastify.post('/', async (request, reply) => {
    try {
      const product = await productService.createProduct(request.body as any);
      return reply.code(201).send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  // 2. LISTAGEM PAGINADA: GET /api/products
  fastify.get('/', async (request, reply) => {
    try {
      const { page, limit, search, category, is_active } = request.query as any;

      // Construímos o objeto de filtros dinamicamente (Padrão Sênior)
      const filters: { search?: string; category?: string; is_active?: boolean } = {};

      if (search !== undefined) filters.search = String(search);
      if (category !== undefined) filters.category = String(category);
      if (is_active !== undefined) filters.is_active = is_active === 'true';

      const result = await productService.getProducts(
        page ? Number(page) : 1,
        limit ? Number(limit) : 10,
        filters
      );

      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  // 3. BUSCA POR ID: GET /api/products/:id
  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const product = await productService.getProductById(id);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  // 4. BUSCA POR SLUG (Essencial para E-commerce): GET /api/products/slug/:slug
  fastify.get('/slug/:slug', async (request, reply) => {
    try {
      const { slug } = request.params as { slug: string };
      const product = await productService.getProductBySlug(slug);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  // 5. UPDATE: PUT /api/products/:id
  fastify.put('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const product = await productService.updateProduct(id, request.body as any);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  // 6. DELETE: DELETE /api/products/:id
  fastify.delete('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await productService.deleteProduct(id);

      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};