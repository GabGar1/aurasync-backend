import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import type { FastifyRequest, FastifyReply } from "fastify";
import { inventoryRoutes } from "./inventory.router.js";
import { productService } from "../services/product.service.js";
import { cleanupDatabase } from "../test/setup.js";

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
  await app.register(inventoryRoutes, { prefix: "/api/inventory" });
  return app;
};

describe("Inventory Router Auth", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;
  let testVariantId: string;

  before(async () => {
    await cleanupDatabase();

    app = await buildApp();

    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });

    const product = await productService.createProduct({
      slug: "auth-inventory-test-product",
      name: "Auth Inventory Test",
      variants: [{ price: 100, stock_quantity: 50 }],
    });
    testVariantId = product.variants[0]!.id;
  });

  after(async () => {
    await app.close();
    await cleanupDatabase();
  });

  describe("POST / — create transaction", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory",
        body: { variant_id: testVariantId, type: "RESTOCK", quantity_changed: 10 },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { variant_id: testVariantId, type: "RESTOCK", quantity_changed: 10 },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 201 for ADMIN role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { variant_id: testVariantId, type: "RESTOCK", quantity_changed: 10 },
      });
      assert.strictEqual(res.statusCode, 201);
    });
  });

  describe("GET /variant/:variantId — variant history", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/api/inventory/variant/${testVariantId}` });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 200 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/inventory/variant/${testVariantId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/inventory/variant/${testVariantId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("GET / — global history", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/api/inventory" });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 200 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });
});
