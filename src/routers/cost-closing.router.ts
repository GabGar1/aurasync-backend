import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { costClosingService } from '../services/cost-closing.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const costClosingRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      body: z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    },
  }, async (request, reply) => {
    return reply.send(await costClosingService.closeMonth(request.body));
  });
};
