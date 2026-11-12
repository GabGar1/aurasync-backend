import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { productSubgroupService } from '../services/product-subgroup.service.js';
import { ProductSubgroupSchema } from '../schemas/product-subgroup.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";
import { clampLimit, clampPage } from "../lib/config.js";

export const productSubgroupRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { querystring: z.object({ is_active: z.string().optional(), search: z.string().optional() }) },
  }, async (request, reply) => {
    const { is_active, search } = request.query;
    const filters: { is_active?: boolean; search?: string } = {};
    if (is_active !== undefined) filters.is_active = is_active === 'true';
    if (search !== undefined) filters.search = search;
    return reply.send(await productSubgroupService.listSubgroups(filters));
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: ProductSubgroupSchema.create },
  }, async (request, reply) => {
    return reply.code(201).send(await productSubgroupService.createSubgroup(request.body));
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: ProductSubgroupSchema.update },
  }, async (request, reply) => {
    const sg = await productSubgroupService.updateSubgroup(request.params.id, request.body);
    if (!sg) return reply.code(404).send({ error: 'Subgroup not found' });
    return reply.send(sg);
  });

  fastify.post('/:id/products', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: ProductSubgroupSchema.assignProducts },
  }, async (request, reply) => {
    return reply.send(await productSubgroupService.assignProductsToSubgroup(request.params.id, request.body.product_ids));
  });

  fastify.get('/:id/products', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional(),
      }),
    },
  }, async (request, reply) => {
    const { page, limit, search } = request.query;
    const result = await productSubgroupService.listProducts(request.params.id, clampPage(page), clampLimit(limit, 10), search);
    return reply.send(result);
  });

  fastify.delete('/:id/products/:productId', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid(), productId: z.string().uuid() }) },
  }, async (request, reply) => {
    const removed = await productSubgroupService.unassignProduct(request.params.id, request.params.productId);
    if (!removed) return reply.code(404).send({ error: 'Product not in subgroup' });
    return reply.code(204).send();
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    const deleted = await productSubgroupService.deleteSubgroup(request.params.id);
    if (!deleted) return reply.code(404).send({ error: 'Subgroup not found' });
    return reply.code(204).send();
  });
};
