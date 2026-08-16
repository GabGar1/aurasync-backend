import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { productRoutes } from "./product.router.js";
import { authRoutes } from "./auth.router.js";
import { userRoutes } from "./user.router.js";
import { db } from "../lib/db.js";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { closeDatabase } from "../test/setup.js";

after(async () => {
  await closeDatabase();
});

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: string; name: string };
    user: { sub: string; role: string; name: string };
  }
}

const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: "test-secret" });
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Token ausente ou inválido!" });
    }
  });
  await app.register(productRoutes, { prefix: "/api/products" });
  return app;
};

describe("Security: product reads require auth", () => {
  let app: FastifyInstance;
  let employeeToken: string;

  before(async () => {
    app = await buildApp();
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });
  });

  after(async () => {
    await app.close();
  });

  it("rejects GET / without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/" });
    assert.strictEqual(res.statusCode, 401);
  });

  it("rejects GET /:id without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/00000000-0000-4000-8000-000000000000" });
    assert.strictEqual(res.statusCode, 401);
  });

  it("allows GET / with any authenticated role", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/", headers: { authorization: `Bearer ${employeeToken}` } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.products));
  });
});

describe("Security: login rate limit", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Token ausente ou inválido!" });
      }
    });
    await app.register(rateLimit, { global: false });
    await app.register(authRoutes, { prefix: "/api/auth" });
  });

  after(async () => {
    await app.close();
  });

  it("rejects the 6th login attempt from the same IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@none.test", password: "wrongpass" },
      });
      statuses.push(res.statusCode);
    }
    assert.strictEqual(statuses[5], 429);
  });
});

describe("Security: helmet headers", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Token ausente ou inválido!" });
      }
    });
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(authRoutes, { prefix: "/api/auth" });
  });

  after(async () => {
    await app.close();
  });

  it("emits nosniff on every response", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "x@y.z", password: "p" } });
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  });
});

describe("Security: error leakage", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Token ausente ou inválido!" });
      }
    });
    app.setErrorHandler((error, _request, reply) => {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    });
    app.get('/boom', async () => {
      throw new Error('db-password-here');
    });
  });

  after(async () => {
    await app.close();
  });

  it("does not leak raw error messages", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });
    assert.strictEqual(res.statusCode, 500);
    const body = res.json();
    assert.strictEqual(body.error, 'Internal server error');
    assert.ok(!JSON.stringify(body).includes('db-password-here'));
  });
});

describe("Security: SUPER_ADMIN protection", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let superId: string;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Token ausente ou inválido!" });
      }
    });
    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    await app.register(userRoutes, { prefix: "/api" });

    const { userService } = await import("../services/user.service.js");
    const sup = await userService.createUser({
      first_name: "Root", last_name: "Super", email: "protect.super@aurasync.com", password: "Sup3rSecret!123",
    });
    superId = sup.id;
    await db("users").where({ id: superId }).update({ role: "SUPER_ADMIN" });
  });

  after(async () => {
    await db("users").where({ id: superId }).del();
    await app.close();
  });

  it("blocks ADMIN from deleting a SUPER_ADMIN", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${superId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.statusCode, 403);
  });
});

describe("Security: webhook body limit", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Token ausente ou inválido!" });
      }
    });
    const { webhookRoutes } = await import("./webhook.router.js");
    await app.register(webhookRoutes, { prefix: "/api/webhooks" });
  });

  after(async () => {
    await app.close();
  });

  it("rejects oversized webhook payloads", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/nuvemshop",
      headers: { "x-webhook-event": "product/created", "content-type": "application/json" },
      payload: { data: "x".repeat(2 * 1024 * 1024) },
    });
    assert.strictEqual(res.statusCode, 413);
  });
});