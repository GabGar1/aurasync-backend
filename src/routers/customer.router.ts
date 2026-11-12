import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { customerService } from '../services/customer.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";
import { clampLimit, clampPage } from "../lib/config.js";

export const customerRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional(),
      }),
    },
  }, async (request, reply) => {
    const { page, limit, search } = request.query;
    const filters: { search?: string } = {};
    if (search !== undefined) filters.search = search;
    const result = await customerService.listCustomers(clampPage(page), clampLimit(limit, 20), filters);
    return reply.send(result);
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      body: z.object({
        name: z.string().min(1, 'Nome é obrigatório').max(255),
        email: z.string().email('Email inválido').optional(),
        city: z.string().max(255).optional(),
        province: z.string().max(10).optional(),
      }),
    },
  }, async (request, reply) => {
    const customer = await customerService.createCustomer(request.body);
    return reply.code(201).send(customer);
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    const customer = await customerService.getCustomer(request.params.id);
    if (!customer) return reply.code(404).send({ error: 'Customer not found' });
    return reply.send(customer);
  });

  fastify.get('/:id/orders', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    const orders = await customerService.getCustomerOrders(request.params.id);
    if (orders === null) return reply.code(404).send({ error: 'Customer not found' });
    return reply.send(orders);
  });
};
