import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { UserSchema } from "../schemas/user.schema.js";
import { userService } from "../services/user.service.js";
import { deriveCsrfToken } from "../middlewares/csrf.middleware.js";
import "@fastify/jwt";

export const authRoutes: FastifyPluginAsyncZod = async (app) => {

  app.post("/login", {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: UserSchema.login }
  }, async (request, reply) => {
    try {
      const user = await userService.authenticateUser(request.body);
      if (!user) {
        return reply.status(401).send({ error: "Invalid email or password" });
      }

      const token = app.jwt.sign(
        { sub: user.id, role: user.role, name: user.first_name },
        { expiresIn: "2h" }
      );

      reply.setCookie('aurasync_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 7200,
      });

      return reply.status(200).send({ token, user });
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  app.get("/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      const user = await userService.getUserById(request.user.sub);
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      return reply.send({
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
      });
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  });

  app.post("/logout", async (_request, reply) => {
    reply.clearCookie('aurasync_token', { path: '/' });
    return reply.send({ message: "Logged out successfully" });
  });

  app.get("/csrf", { onRequest: [app.authenticate] }, async (request, reply) => {
    const jwtCookie = request.cookies['aurasync_token'];
    if (!jwtCookie) {
      return reply.status(401).send({ error: "Session cookie not found. Use cookie-based auth." });
    }

    const csrfToken = deriveCsrfToken(jwtCookie);

    reply.setCookie('XSRF-TOKEN', csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return reply.send({ csrfToken });
  });
};
