import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { productService } from '../services/product.service.js';
import {requireRole} from "../middlewares/role.middleware";
import {nuvemshopService} from "../services/nuvemshop.service";
import { ProductSchema } from '../schemas/product.schema.js';
import { z } from "zod";

export const productRoutes: FastifyPluginAsyncZod = async (fastify) => {

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: ProductSchema.create }
  }, async (request, reply) => {
    try {
      const product = await productService.createProduct(request.body);
      return reply.code(201).send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/sync/nuvemshop', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
  }, async (request, reply) => {
    try {
      const result = await nuvemshopService.syncProducts();
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });


  fastify.get('/', {
    schema: {
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional(),
        category: z.string().optional(),
        is_active: z.string().optional(),
      }),
    },
  }, async (request, reply) => {
    try {
      const { page, limit, search, category, is_active } = request.query;

      const filters: { search?: string; category?: string; is_active?: boolean } = {};

      if (search !== undefined) filters.search = search;
      if (category !== undefined) filters.category = category;
      if (is_active !== undefined) filters.is_active = is_active === 'true';

      const result = await productService.getProducts(
        page ?? 1,
        limit ?? 10,
        filters
      );

      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/:id', {
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const product = await productService.getProductById(id);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/slug/:slug', {
    schema: { params: z.object({ slug: z.string().min(1) }) },
  }, async (request, reply) => {
    try {
      const { slug } = request.params;
      const product = await productService.getProductBySlug(slug);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: ProductSchema.update,
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const product = await productService.updateProduct(id, request.body);

      if (!product) return reply.code(404).send({ error: 'Product not found' });

      return reply.send(product);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      await productService.deleteProduct(id);

      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};