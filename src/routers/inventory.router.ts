import type { FastifyPluginAsync } from 'fastify';
import { inventoryService } from '../services/inventory.service.js';

export const inventoryRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post('/', async (request, reply) => {
    try {
      // O body deve conter variant_id, type e quantity_changed
      const transaction = await inventoryService.addTransaction(request.body as any);
      return reply.code(201).send(transaction);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/variant/:variantId', async (request, reply) => {
    try {
      const { variantId } = request.params as { variantId: string };
      const history = await inventoryService.getVariantHistory(variantId);

      return reply.send(history);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const { page, limit } = request.query as any;
      const history = await inventoryService.getGlobalHistory(
        page ? Number(page) : 1,
        limit ? Number(limit) : 50
      );
      return reply.send(history);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

};