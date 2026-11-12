import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { orderService } from '../services/order.service.js';
import { nuvemshopService } from '../services/nuvemshop.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { OrderSchema } from '../schemas/order.schema.js';
import { z } from "zod";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { clampLimit, clampPage } from "../lib/config.js";
import { ConflictError } from "../lib/errors.js";

export const orderRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { body: OrderSchema.create } }, async (request, reply) => {
    const order = await orderService.createOrder(request.body);
    return reply.code(201).send(order);
  });

  fastify.post('/sync/nuvemshop', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { querystring: z.object({ full: z.enum(['true', 'false']).optional() }) } }, async (request, reply) => {
    if (nuvemshopService.isSyncing('orders')) {
      throw new ConflictError('Synchronization already in progress');
    }
    // Runs in the background (orders sync can take minutes); the result reaches the UI over the websocket.
    nuvemshopService.syncOrders({ full: request.query.full === 'true' }).catch((error) => {
      request.log.error({ err: error }, 'Background order sync failed');
    });

    return reply.code(202).send({ message: "Synchronization process started in the background." });
  });


  fastify.get('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { querystring: z.object({ page: z.coerce.number().optional(), limit: z.coerce.number().optional(), fulfillment_status: z.string().optional(), search: z.string().optional() }) } }, async (request, reply) => {
    const { page, limit, fulfillment_status, search } = request.query;

    const filters: { fulfillment_status?: string; search?: string } = {};
    if (fulfillment_status !== undefined) filters.fulfillment_status = fulfillment_status;
    if (search !== undefined) filters.search = search;

    const result = await orderService.getOrders(
      clampPage(page),
      clampLimit(limit, 10),
      filters
    );

    return reply.send(result);
  });

  fastify.get('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
    const { id } = request.params;
    const order = await orderService.getOrderById(id);

    if (!order) return reply.code(404).send({ error: 'Order not found' });

    return reply.send(order);
  });

  fastify.put('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }), body: OrderSchema.update } }, async (request, reply) => {
    const { id } = request.params;
    const order = await orderService.updateOrder(id, request.body);

    if (!order) return reply.code(404).send({ error: 'Order not found' });

    return reply.send(order);
  });

  fastify.delete('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
    const { id } = request.params;
    await orderService.deleteOrder(id);

    return reply.code(204).send();
  });
};