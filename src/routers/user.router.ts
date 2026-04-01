import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UserSchema } from "../schemas/user.schema.js";
import { userService } from "../services/user.service.js";
import "@fastify/jwt";
import { z } from "zod";

// Auth middleware to verify JWT
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
  // POST /api/users - Create user
  app.post(
    "/users",
    {
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

  // POST /api/login - Authenticate user
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
          { expiresIn: "7d" }
        );

        return reply.status(200).send({ token, user });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  // GET /api/users - List users (protected)
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

        // O truque Sênior: Só adicionamos a chave no objeto se ela tiver um valor real!
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

  // GET /api/users/:id - Get user by ID (protected)
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

  // PUT /api/users/:id - Update user (protected)
  app.put(
    "/users/:id",
    {
      onRequest: [app.authenticate],
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

  // PUT /api/users/:id/password - Change password (protected)
  app.put(
    "/users/:id/password",
    {
      onRequest: [app.authenticate],
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

  // DELETE /api/users/:id - Delete user (protected)
  app.delete(
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

  // GET /api/users/role/:role - Get users by role (protected)
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

  // GET /api/users/stats - Get user stats (protected)
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

  // GET /api/users/check-email - Check email availability
  app.get(
    "/users/check-email",
    {
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
