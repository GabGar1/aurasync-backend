import type { FastifyPluginAsync } from "fastify";
import { dashboardService } from "../services/dashboard.service.js";
import {
  DashboardStockResponse,
  DashboardMarketingResponse,
  DashboardOrdersResponse,
} from "../schemas/dashboard.schema.js";
import { requireRole } from "../middlewares/role.middleware.js";
import { z } from "zod";

// Reports look back at most one year; an unbounded window turns into a full-table scan.
const days = z.coerce.number().int().min(1).max(365).default(30);

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/dashboard/stock",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({ days }),
      },
    },
    async (request, reply) => {
      const { days: windowDays } = request.query as { days: number };
      const data = await dashboardService.getStockStats(windowDays);
      return reply.send(DashboardStockResponse.parse(data));
    }
  );

  app.get(
    "/dashboard/marketing",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          days,
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { days: windowDays, start_date, end_date } = request.query as {
        days: number;
        start_date?: string;
        end_date?: string;
      };
      const dates = {
        ...(start_date ? { start_date } : {}),
        ...(end_date ? { end_date } : {}),
      };
      const data = await dashboardService.getMarketingStats(windowDays, dates);
      return reply.send(DashboardMarketingResponse.parse(data));
    }
  );

  app.get(
    "/dashboard/orders",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          days,
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { days: windowDays, start_date, end_date } = request.query as {
        days: number;
        start_date?: string;
        end_date?: string;
      };
      const dates = {
        ...(start_date ? { start_date } : {}),
        ...(end_date ? { end_date } : {}),
      };
      const data = await dashboardService.getOrdersStats(windowDays, dates);
      return reply.send(DashboardOrdersResponse.parse(data));
    }
  );
};
