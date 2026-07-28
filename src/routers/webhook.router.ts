import type { FastifyPluginAsync } from 'fastify';
import { verifyNuvemshopWebhook } from '../middlewares/nuvemshop.middleware.js';
import { productService } from '../services/product.service.js';
import { orderService } from '../services/order.service.js';
export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/nuvemshop',
    { preHandler: [verifyNuvemshopWebhook] },
    async (request, reply) => {
      const event = request.headers['x-webhook-event'] as string;

      console.log(`Webhook event received: ${event}`);

      try {
        switch (event) {
          case 'product/created':
          case 'product/updated':
            await productService.handleNuvemshopWebhook(request.body as any);
            break;

          case 'product/deleted':
            // TODO: Implementar lógica para soft-delete ou desativar produto
            console.log(`Product deleted event received: ${JSON.stringify(request.body)}`);
            break;

          case 'order/created':
          case 'order/updated':
            await orderService.handleNuvemshopWebhook(request.body as any);
            break;

          default:
            console.warn(`Unhandled webhook event: ${event}`);
        }

        return reply.code(200).send({ status: 'received', event: event });
      } catch (error: any) {
        console.error(`Error processing webhook event ${event}:`, error.response?.data || error.message);
        return reply.code(500).send({ error: 'Internal server error', details: error.message });
      }
    }
  );
};
