import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { inventoryService } from '../services/inventory.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { InventorySchema } from '../schemas/inventory.schema.js';
import { z } from "zod";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { clampLimit, clampPage } from "../lib/config.js";

export const inventoryRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { body: InventorySchema.create } }, async (request, reply) => {
    const transaction = await inventoryService.addTransaction(request.body);
    return reply.code(201).send(transaction);
  });

  fastify.get('/variant/:variantId', { onRequest: [fastify.authenticate], schema: { params: z.object({ variantId: z.string().uuid() }) } }, async (request, reply) => {
    const { variantId } = request.params;
    const history = await inventoryService.getVariantHistory(variantId);

    return reply.send(history);
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        type: z.enum(['SALE', 'RESTOCK', 'ADJUSTMENT']).optional(),
        search: z.string().max(100).optional(),
      }),
    }
  }, async (request, reply) => {
    const { page, limit, type, search } = request.query;
    const history = await inventoryService.getGlobalHistory(
      clampPage(page),
      clampLimit(limit, 50),
      { ...(type ? { type } : {}), ...(search ? { search } : {}) }
    );
    return reply.send(history);
  });

};