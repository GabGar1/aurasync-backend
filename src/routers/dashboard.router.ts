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
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          days: z.coerce.number().default(30),
        }),
      },
    },
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
          start_date: z.string().optional(),
          end_date: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { days, start_date, end_date } = request.query as {
          days: number;
          start_date?: string;
          end_date?: string;
        };
        const dates = {
          ...(start_date ? { start: new Date(start_date) } : {}),
          ...(end_date ? { end: new Date(end_date) } : {}),
        };
        const data = await dashboardService.getMarketingStats(days, dates);
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
          start_date: z.string().optional(),
          end_date: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { days, start_date, end_date } = request.query as {
          days: number;
          start_date?: string;
          end_date?: string;
        };
        const dates = {
          ...(start_date ? { start: new Date(start_date) } : {}),
          ...(end_date ? { end: new Date(end_date) } : {}),
        };
        const data = await dashboardService.getOrdersStats(days, dates);
        return reply.send(DashboardOrdersResponse.parse(data));
      } catch (error: any) {
        return reply.status(500).send({ error: error.message });
      }
    }
  );
};
