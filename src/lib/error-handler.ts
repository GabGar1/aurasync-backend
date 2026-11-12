import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

interface ValidationIssue {
  instancePath?: string;
  message?: string;
  params?: { issue?: { path?: PropertyKey[] } };
}

function fieldOf(issue: ValidationIssue): string {
  const fromPath = issue.instancePath?.replace(/^\//, '').replaceAll('/', '.');
  if (fromPath) return fromPath;
  return issue.params?.issue?.path?.map(String).join('.') ?? '';
}

function sendValidationError(reply: FastifyReply, details: Array<{ field: string; message: string }>) {
  return reply.code(400).send({ error: 'Validation failed', details });
}

/**
 * Global error handler.
 * - Schema validation (Zod via fastify-type-provider-zod) → 400 with field details
 * - Domain errors (AppError) → their status and message
 * - Other client errors raised by Fastify or plugins (413, 415, 429…) → kept as-is
 * - Anything else → 500, logged, message never exposed
 */
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error.validation) {
    const details = (error.validation as ValidationIssue[]).map((issue) => ({
      field: fieldOf(issue),
      message: issue.message ?? 'Invalid value',
    }));
    return sendValidationError(reply, details);
  }

  // Zod parse() called inside a service with input that bypassed the route schema.
  if (error instanceof ZodError) {
    return sendValidationError(reply, error.issues.map((i) => ({ field: i.path.map(String).join('.'), message: i.message })));
  }

  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  const status = error.statusCode ?? 500;
  if (status === 429) {
    return reply.code(429).send({ error: 'Too Many Requests' });
  }
  if (status >= 400 && status < 500) {
    return reply.code(status).send({ error: error.message });
  }

  request.log.error({ err: error, url: request.url }, 'Unhandled error');
  return reply.code(500).send({ error: 'Internal server error' });
}
