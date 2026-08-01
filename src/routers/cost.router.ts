import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { costService } from '../services/cost.service.js';
import { CostSchema } from '../schemas/cost.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const costRoutes: FastifyPluginAsyncZod = async (fastify) => {
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
      const components = await costService.listComponents(filters);
      return reply.send(components);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.create },
  }, async (request, reply) => {
    try {
      const component = await costService.createComponent(request.body);
      return reply.code(201).send(component);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: CostSchema.update },
  }, async (request, reply) => {
    try {
      const component = await costService.updateComponent(request.params.id, request.body);
      if (!component) return reply.code(404).send({ error: 'Cost component not found' });
      return reply.send(component);
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
      const deleted = await costService.deleteComponent(request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Cost component not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/associate', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.associate },
  }, async (request, reply) => {
    try {
      const association = await costService.associateComponent(request.body);
      return reply.code(201).send(association);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/associate/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const removed = await costService.removeAssociation(request.params.id);
      if (!removed) return reply.code(404).send({ error: 'Association not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/product/:productId', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ productId: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const associations = await costService.getAssociationsByProduct(request.params.productId);
      return reply.send({ associations });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/simulate', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.simulate },
  }, async (request, reply) => {
    try {
      const result = await costService.simulateCosts(request.body);
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
