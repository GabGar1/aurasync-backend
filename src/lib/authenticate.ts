import type { FastifyReply, FastifyRequest } from 'fastify';
import { userService } from '../services/user.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID_SESSION = { error: 'Token ausente ou inválido!' };

/**
 * Route guard (`onRequest: [app.authenticate]`).
 * Besides the JWT signature it checks the user against the database on every request, so
 * deactivation, deletion, logout and password changes take effect immediately, and the
 * role used by `requireRole` is always the current one (never the role frozen in the token).
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send(INVALID_SESSION);
  }

  const { sub, tv } = request.user;
  if (!UUID.test(sub)) {
    return reply.status(401).send(INVALID_SESSION);
  }

  const state = await userService.getAuthState(sub);
  if (!state || !state.status || (tv ?? 0) !== state.token_version) {
    return reply.status(401).send(INVALID_SESSION);
  }

  request.user.role = state.role;
}
