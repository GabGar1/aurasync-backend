import type { FastifyPluginAsync } from 'fastify';
import { healthService } from '../services/health.service.js';

/**
 * Liveness/readiness probe for Docker and the reverse proxy. Public on purpose:
 * it exposes no data, only whether the API and the database answer.
 */
export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // Probed every 30s by Docker: keep it out of the request log (errors still show).
  fastify.get('/', { config: { rateLimit: false }, logLevel: 'warn' }, async (_request, reply) => {
    const report = await healthService.check();
    return reply.code(report.status === 'ok' ? 200 : 503).send(report);
  });
};
