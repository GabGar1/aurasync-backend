import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UserSchema } from "../schemas/user.schema.js";
import { userService } from "../services/user.service.js";
import { requireRole } from "../middlewares/role.middleware.js";
import "@fastify/jwt";
import { z } from "zod";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string; name: string };
    user: {
      sub: string;
      role: string;
      name: string;
    };
  }
}

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
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
      try {
        const user = await userService.createUser(request.body);
        return reply.status(201).send(user);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.post(
    "/login",
    {
      schema: {
        body: UserSchema.login,
      },
    },
    async (request, reply) => {
      try {
        const user = await userService.authenticateUser(request.body);

        if (!user) {
          return reply.status(401).send({ error: "Invalid email or password" });
        }

        const token = app.jwt.sign(
          { sub: user.id, role: user.role, name: user.first_name },
          { expiresIn: "2h" }
        );

        return reply.status(200).send({ token, user });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.get(
    "/users",
    {
      onRequest: [app.authenticate],
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
      try {
        const { page, limit, role, search } = request.query;

        const filters: { role?: string; search?: string } = {};
        if (role) filters.role = role;
        if (search) filters.search = search;

        const result = await userService.getUsers(page, limit, filters);
        return reply.send(result);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.get(
    "/users/:id",
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const user = await userService.getUserById(request.params.id);
        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }
        return reply.send(user);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
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
      try {
        const user = await userService.updateUser(request.params.id, request.body);
        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }
        return reply.send(user);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.put(
    "/users/:id/password",
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
        body: UserSchema.changePassword,
      },
    },
    async (request, reply) => {
      try {
        const success = await userService.changePassword(request.params.id, request.body);
        if (!success) {
          return reply.status(400).send({ error: "Failed to change password" });
        }
        return reply.send({ message: "Password changed successfully" });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
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
      try {
        const success = await userService.deleteUser(request.params.id);
        if (!success) {
          return reply.status(404).send({ error: "User not found" });
        }
        return reply.status(204).send();
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.get(
    "/users/role/:role",
    {
      onRequest: [app.authenticate],
      schema: {
        params: z.object({
          role: z.string(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const users = await userService.getUsersByRole(request.params.role);
        return reply.send(users);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.get(
    "/users/stats",
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      try {
        const stats = await userService.getUserStats();
        return reply.send(stats);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  app.get(
    "/users/check-email",
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: z.object({
          email: z.string().email(),
          excludeId: z.string().uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const available = await userService.isEmailAvailable(
          request.query.email,
          request.query.excludeId
        );
        return reply.send({ available });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );
};
