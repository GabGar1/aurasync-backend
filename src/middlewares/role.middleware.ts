import type { FastifyRequest, FastifyReply } from 'fastify';

export function requireRole(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;

    if (!user || !allowedRoles.includes(user.role)) {
      return reply.code(403).send({
        error: 'Forbidden: You do not have permission to perform this action.'
      });
    }
  };
}
