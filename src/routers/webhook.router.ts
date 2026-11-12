import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyNuvemshopWebhook } from '../middlewares/nuvemshop.middleware.js';
import { nuvemshopService } from '../services/nuvemshop.service.js';

// Nuvemshop sends only identifiers; the record itself is fetched from the API.
const webhookBody = z.object({
  store_id: z.union([z.number(), z.string()]).optional(),
  event: z.string().min(1),
  id: z.union([z.number(), z.string().min(1)]),
});

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/nuvemshop',
    {
      preHandler: [verifyNuvemshopWebhook],
      bodyLimit: 1024 * 1024,
      // Deliveries are authenticated by HMAC; throttling them makes Nuvemshop retry and eventually disable the webhook.
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const payload = webhookBody.parse(request.body);
      const result = await nuvemshopService.handleWebhook(payload);
      request.log.info({ event: payload.event, id: payload.id, status: result.status, reason: result.reason }, 'Nuvemshop webhook');
      // Any error propagates to the global handler (5xx), so Nuvemshop retries the delivery.
      return reply.code(200).send(result);
    }
  );
};
