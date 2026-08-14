import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { productSubgroupService } from '../services/product-subgroup.service.js';
import { ProductSubgroupSchema } from '../schemas/product-subgroup.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const productSubgroupRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { querystring: z.object({ is_active: z.string().optional(), search: z.string().optional() }) },
  }, async (request, reply) => {
    try {
      const { is_active, search } = request.query;
      const filters: { is_active?: boolean; search?: string } = {};
      if (is_active !== undefined) filters.is_active = is_active === 'true';
      if (search !== undefined) filters.search = search;
      return reply.send(await productSubgroupService.listSubgroups(filters));
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: ProductSubgroupSchema.create },
  }, async (request, reply) => {
    try {
      return reply.code(201).send(await productSubgroupService.createSubgroup(request.body));
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: ProductSubgroupSchema.update },
  }, async (request, reply) => {
    try {
      const sg = await productSubgroupService.updateSubgroup(request.params.id, request.body);
      if (!sg) return reply.code(404).send({ error: 'Subgroup not found' });
      return reply.send(sg);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/:id/products', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: ProductSubgroupSchema.assignProducts },
  }, async (request, reply) => {
    try {
      return reply.send(await productSubgroupService.assignProductsToSubgroup(request.params.id, request.body.product_ids));
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
      const deleted = await productSubgroupService.deleteSubgroup(request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Subgroup not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
