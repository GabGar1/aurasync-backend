import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import type { FastifyRequest, FastifyReply } from "fastify";
import { orderRoutes } from "./order.router.js";
import { productService } from "../services/product.service.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

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
  await app.register(orderRoutes, { prefix: "/api/orders" });
  return app;
};

describe("Order Router Auth", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;
  let testVariantId: string;
  let testOrderId: string;

  before(async () => {
    await cleanupDatabase();

    app = await buildApp();

    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });

    const product = await productService.createProduct({
      slug: "auth-order-test-product",
      name: "Auth Test Product",
      variants: [{ price: 100, stock_quantity: 50 }],
    });
    testVariantId = product.variants[0]!.id;

    const orderRes = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: { authorization: `Bearer ${adminToken}` },
      body: { customer_name: "Seed Order", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
    });
    testOrderId = orderRes.json().id;
  });

  after(async () => {
    await app.close();
    await cleanupDatabase();
    await closeDatabase();
  });

  describe("POST / — create order", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        body: { customer_name: "Test", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { customer_name: "Test", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 201 for ADMIN role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { customer_name: "Another Order", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
      });
      assert.strictEqual(res.statusCode, 201);
    });
  });

  describe("POST /sync/nuvemshop — sync orders (401 only, skips real API)", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders/sync/nuvemshop",
      });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  describe("GET / — list orders", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/api/orders" });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/orders",
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/orders",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("GET /:id — get order by ID", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/api/orders/${testOrderId}` });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("PUT /:id — update order", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/orders/${testOrderId}`,
        body: { customer_name: "Hacker" },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { customer_name: "Should Fail" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        body: { customer_name: "Admin Updated" },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("DELETE /:id — delete order", () => {
    let deleteOrderId: string;

    before(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { customer_name: "To Delete", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 50 }] },
      });
      deleteOrderId = res.json().id;
    });

    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "DELETE", url: `/api/orders/${deleteOrderId}` });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/orders/${deleteOrderId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 204 for ADMIN role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/orders/${deleteOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 204);
    });
  });
});
