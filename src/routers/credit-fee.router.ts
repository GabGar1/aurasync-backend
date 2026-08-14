import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { creditFeeService } from '../services/credit-fee.service.js';
import { CreditFeeSchema } from '../schemas/credit-fee.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const creditFeeRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
  }, async (request, reply) => {
    try {
      return reply.send(await creditFeeService.listTiers());
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: CreditFeeSchema.update },
  }, async (request, reply) => {
    try {
      const tier = await creditFeeService.updateTier(request.params.id, request.body);
      if (!tier) return reply.code(404).send({ error: 'Credit fee tier not found' });
      return reply.send(tier);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
