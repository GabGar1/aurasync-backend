import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { productRoutes } from "./product.router.js";
import { closeDatabase } from "../test/setup.js";

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
    await closeDatabase();
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