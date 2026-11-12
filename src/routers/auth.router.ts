import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { UserSchema } from "../schemas/user.schema.js";
import { userService } from "../services/user.service.js";
import { deriveCsrfToken, csrfProtection } from "../middlewares/csrf.middleware.js";
import "@fastify/jwt";

const SESSION_COOKIE = 'aurasync_token';
const SESSION_TTL_SECONDS = 2 * 60 * 60;

/** Signs a JWT bound to the user's current token_version and stores it in the httpOnly cookie. */
async function issueSession(app: FastifyInstance, reply: FastifyReply, user: { id: string; role: string; first_name: string }) {
  const state = await userService.getAuthState(user.id);
  const token = app.jwt.sign(
    { sub: user.id, role: user.role, name: user.first_name, tv: state?.token_version ?? 0 },
    { expiresIn: SESSION_TTL_SECONDS }
  );
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {

  app.post("/login", {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: UserSchema.login }
  }, async (request, reply) => {
    const user = await userService.authenticateUser(request.body);
    if (!user) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    await issueSession(app, reply, user);

    // The JWT lives only in the httpOnly cookie; returning it would make it readable by scripts.
    return reply.status(200).send({ user });
  });

  app.get("/me", { onRequest: [app.authenticate] }, async (request, reply) => {
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
  });

  // Any signed-in user changes their own password; other sessions are revoked and this one is renewed.
  app.put("/me/password", {
    onRequest: [app.authenticate],
    preHandler: [csrfProtection()],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: UserSchema.changePassword },
  }, async (request, reply) => {
    await userService.changePassword(request.user.sub, request.body);
    const user = await userService.getUserById(request.user.sub);
    if (user) await issueSession(app, reply, user);
    return reply.send({ message: "Password changed successfully" });
  });

  app.post("/logout", { preHandler: [csrfProtection()] }, async (request, reply) => {
    // Revoke the token server-side too, so a copied token stops working after logout.
    try {
      await request.jwtVerify();
      await userService.revokeSessions(request.user.sub);
    } catch {
      // Expired or missing token: nothing to revoke, just clear the cookies.
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie('XSRF-TOKEN', { path: '/' });
    return reply.send({ message: "Logged out successfully" });
  });

  app.get("/csrf", { onRequest: [app.authenticate] }, async (request, reply) => {
    const jwtCookie = request.cookies[SESSION_COOKIE];
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
