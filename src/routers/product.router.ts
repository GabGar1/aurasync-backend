import type { FastifyPluginAsync } from 'fastify';
import { productService } from '../services/product.service.js';
import {requireRole} from "../middlewares/role.middleware";
import {nuvemshopService} from "../services/nuvemshop.service";

export const productRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
  }, async (request, reply) => {
    try {
      const product = await productService.createProduct(request.body as any);
      return reply.code(201).send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/sync/nuvemshop', {
    onRequest: [fastify.authenticate] // Protegida! Só logado pode apertar o botão
  }, async (request, reply) => {
    try {
      const result = await nuvemshopService.syncProducts();
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/', async (request, reply) => {
    try {
      const { page, limit, search, category, is_active } = request.query as any;

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

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const product = await productService.updateProduct(id, request.body as any);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await productService.deleteProduct(id);

      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};