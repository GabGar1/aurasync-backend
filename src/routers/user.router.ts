import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UserSchema } from "../schemas/user.schema.js";
import { userService } from "../services/user.service.js";
import { requireRole } from "../middlewares/role.middleware.js";
import "@fastify/jwt";
import { z } from "zod";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { clampLimit, clampPage } from "../lib/config.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /** tv = users.token_version at sign time; bumping it revokes the token. */
    payload: { sub: string; role: string; name: string; tv?: number };
    user: {
      sub: string;
      role: string;
      name: string;
      tv?: number;
    };
  }
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', csrfProtection());
  app.post(
    "/users",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        body: UserSchema.register,
      },
    },
    async (request, reply) => {
      if (request.body.role && request.user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Only SUPER_ADMIN can set user roles' });
      }
      const user = await userService.createUser(request.body);
      return reply.status(201).send(user);
    }
  );

  app.get(
    "/users",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          page: z.coerce.number().default(1),
          limit: z.coerce.number().default(10),
          role: z.string().optional(),
          search: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const { page, limit, role, search } = request.query;

      const filters: { role?: string; search?: string } = {};
      if (role) filters.role = role;
      if (search) filters.search = search;

      const result = await userService.getUsers(clampPage(page), clampLimit(limit, 10), filters);
      return reply.send(result);
    }
  );

  app.get(
    "/users/:id",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
      },
    },
    async (request, reply) => {
      const user = await userService.getUserById(request.params.id);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      return reply.send(user);
    }
  );

  app.put(
    "/users/:id",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
        body: UserSchema.update,
      },
    },
    async (request, reply) => {
      const target = await userService.getUserById(request.params.id);
      if (!target) {
        return reply.status(404).send({ error: "User not found" });
      }
      if (target.role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Forbidden: cannot modify a SUPER_ADMIN account' });
      }
      if (request.body.role !== undefined && request.user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Only SUPER_ADMIN can change user roles' });
      }
      const user = await userService.updateUser(request.params.id, request.body, request.user.sub);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      return reply.send(user);
    }
  );

  // Admin reset: no current password needed; every session of the target is revoked.
  // Users change their own password through PUT /api/auth/me/password.
  app.post(
    "/users/:id/reset-password",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
        body: UserSchema.resetPassword,
      },
    },
    async (request, reply) => {
      const target = await userService.getUserById(request.params.id);
      if (!target) {
        return reply.status(404).send({ error: "User not found" });
      }
      if (target.role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Forbidden: cannot modify a SUPER_ADMIN account' });
      }
      await userService.resetPassword(request.params.id, request.body.new_password);
      return reply.send({ message: "Password reset successfully" });
    }
  );

  app.delete(
    "/users/:id",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
      },
    },
    async (request, reply) => {
      const target = await userService.getUserById(request.params.id);
      if (!target) {
        return reply.status(404).send({ error: "User not found" });
      }
      if (target.role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN') {
        return reply.status(403).send({ error: 'Forbidden: cannot delete a SUPER_ADMIN account' });
      }
      const success = await userService.deleteUser(request.params.id, request.user.sub);
      if (!success) {
        return reply.status(404).send({ error: "User not found" });
      }
      return reply.status(204).send();
    }
  );

  app.get(
    "/users/role/:role",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        params: z.object({
          role: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const users = await userService.getUsersByRole(request.params.role);
      return reply.send(users);
    }
  );

  app.get(
    "/users/stats",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
    },
    async (request, reply) => {
      const stats = await userService.getUserStats();
      return reply.send(stats);
    }
  );

  app.get(
    "/users/check-email",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        querystring: z.object({
          email: z.string().email(),
          excludeId: z.string().uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const available = await userService.isEmailAvailable(
        request.query.email,
        request.query.excludeId
      );
      return reply.send({ available });
    }
  );
};
