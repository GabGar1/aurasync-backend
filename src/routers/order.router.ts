import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { orderService } from '../services/order.service.js';
import { nuvemshopService } from '../services/nuvemshop.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { OrderSchema } from '../schemas/order.schema.js';
import { z } from "zod";
import { csrfProtection } from "../middlewares/csrf.middleware.js";

export const orderRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { body: OrderSchema.create } }, async (request, reply) => {
    try {
      const order = await orderService.createOrder(request.body);
      return reply.code(201).send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/sync/nuvemshop', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, (request, reply) => {
    // Don't await this. This lets the request finish immediately.
    nuvemshopService.syncOrders().catch(error => {
      console.error("Error during background sync:", error);
    });

    // Immediately respond to the client.
    reply.code(202).send({ message: "Synchronization process started in the background." });
  });


  fastify.get('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { querystring: z.object({ page: z.coerce.number().optional(), limit: z.coerce.number().optional(), status: z.string().optional(), search: z.string().optional() }) } }, async (request, reply) => {
    try {
      const { page, limit, status, search } = request.query;

      const filters: { status?: string; search?: string } = {};
      if (status !== undefined) filters.status = status;
      if (search !== undefined) filters.search = search;

      const result = await orderService.getOrders(
        page ?? 1,
        limit ?? 10,
        filters
      );

      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
    try {
      const { id } = request.params;
      const order = await orderService.getOrderById(id);

      if (!order) return reply.code(404).send({ error: 'Order not found' });

      return reply.send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }), body: OrderSchema.update } }, async (request, reply) => {
    try {
      const { id } = request.params;
      const order = await orderService.updateOrder(id, request.body);

      if (!order) return reply.code(404).send({ error: 'Order not found' });

      return reply.send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
    try {
      const { id } = request.params;
      await orderService.deleteOrder(id);

      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};