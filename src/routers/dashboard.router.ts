import type { FastifyPluginAsync } from "fastify";
import { dashboardService } from "../services/dashboard.service.js";
import {
  DashboardStockResponse,
  DashboardMarketingResponse,
  DashboardOrdersResponse,
} from "../schemas/dashboard.schema.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { z } from "zod";

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/dashboard/stock",
    { onRequest: [app.authenticate], preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])] },
    async (_request, reply) => {
      try {
        const data = await dashboardService.getStockStats();
        return reply.send(DashboardStockResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  app.get(
    "/dashboard/marketing",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          days: z.coerce.number().default(30),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { days } = request.query as { days: number };
        const data = await dashboardService.getMarketingStats(days);
        return reply.send(DashboardMarketingResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );

  app.get(
    "/dashboard/orders",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          days: z.coerce.number().default(30),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { days } = request.query as { days: number };
        const data = await dashboardService.getOrdersStats(days);
        return reply.send(DashboardOrdersResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );
};
