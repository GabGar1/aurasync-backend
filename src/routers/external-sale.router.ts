import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { externalSaleService } from '../services/external-sale.service.js';
import { productService } from '../services/product.service.js';
import { customerService } from '../services/customer.service.js';
import { ExternalSaleSchema } from '../schemas/external-sale.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";
import { clampLimit, clampPage } from "../lib/config.js";

export const externalSaleRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: ExternalSaleSchema.create },
  }, async (request, reply) => {
    const order = await externalSaleService.createExternalSale(request.body);
    return reply.code(201).send(order);
  });

  fastify.get('/products', {
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
    const result = await productService.getProducts(clampPage(page), clampLimit(limit, 20), filters);
    return reply.send(result);
  });

  fastify.get('/customers', {
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
};
