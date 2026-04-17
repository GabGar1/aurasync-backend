import type { FastifyPluginAsync } from 'fastify';
import { orderService } from '../services/order.service.js';

export const orderRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post('/', async (request, reply) => {
    try {
      const order = await orderService.createOrder(request.body as any);
      return reply.code(201).send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/', async (request, reply) => {
    try {
      const { page, limit, status, search } = request.query as any;

      const filters: { status?: string; search?: string } = {};
      if (status !== undefined) filters.status = String(status);
      if (search !== undefined) filters.search = String(search);

      const result = await orderService.getOrders(
        page ? Number(page) : 1,
        limit ? Number(limit) : 10,
        filters
      );

      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const order = await orderService.getOrderById(id);

      if (!order) return reply.code(404).send({ error: 'Order not found' });

      return reply.send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const order = await orderService.updateOrder(id, request.body as any);

      if (!order) return reply.code(404).send({ error: 'Order not found' });

      return reply.send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await orderService.deleteOrder(id);

      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};