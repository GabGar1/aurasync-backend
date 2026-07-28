import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { inventoryService } from '../services/inventory.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { InventorySchema } from '../schemas/inventory.schema.js';
import { z } from "zod";

export const inventoryRoutes: FastifyPluginAsyncZod = async (fastify) => {

  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { body: InventorySchema.create } }, async (request, reply) => {
    try {
      const transaction = await inventoryService.addTransaction(request.body);
      return reply.code(201).send(transaction);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/variant/:variantId', { onRequest: [fastify.authenticate], schema: { params: z.object({ variantId: z.string().uuid() }) } }, async (request, reply) => {
    try {
      const { variantId } = request.params;
      const history = await inventoryService.getVariantHistory(variantId);

      return reply.send(history);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: { querystring: z.object({ page: z.coerce.number().optional(), limit: z.coerce.number().optional() }) }
  }, async (request, reply) => {
    try {
      const { page, limit } = request.query;
      const history = await inventoryService.getGlobalHistory(
        page ?? 1,
        limit ?? 50
      );
      return reply.send(history);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

};