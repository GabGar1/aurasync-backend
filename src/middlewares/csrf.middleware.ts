import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

const CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-dev-secret-change-in-production';

export function deriveCsrfToken(jwt: string): string {
  return crypto.createHmac('sha256', CSRF_SECRET).update(jwt).digest('hex');
}

export function csrfProtection() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }

    const jwtCookie = request.cookies['aurasync_token'];
    if (!jwtCookie) {
      return;
    }

    const headerToken = request.headers['x-csrf-token'] as string | undefined;
    if (!headerToken) {
      return reply.code(403).send({ error: 'Missing CSRF token' });
    }

    const expectedToken = deriveCsrfToken(jwtCookie);
    if (headerToken.length !== expectedToken.length || !crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(expectedToken))) {
      return reply.code(403).send({ error: 'Invalid CSRF token' });
    }
  };
}
