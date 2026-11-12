import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { authRoutes } from "./auth.router.js";
import { userRoutes } from "./user.router.js";
import { orderRoutes } from "./order.router.js";
import { customerRoutes } from "./customer.router.js";
import { externalSaleRoutes } from "./external-sale.router.js";
import { inventoryRoutes } from "./inventory.router.js";
import { errorHandler } from "../lib/error-handler.js";
import { closeDatabase } from "../test/setup.js";
import { db } from "../lib/db.js";

const LOGIN_EMAIL = "http.contract.login@aurasync.com";
const LOGIN_PASSWORD = "ContractPass123!";

describe("HTTP contract", () => {
  let app: FastifyInstance;
  let adminToken: string;

  before(async () => {
    await db("users").where({ email: LOGIN_EMAIL }).del();

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);
    await app.register(fastifyCookie);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch {
        reply.status(401).send({ error: "Token ausente ou inválido!" });
      }
    });
    await app.register(authRoutes, { prefix: "/api/auth" });
    await app.register(userRoutes, { prefix: "/api" });
    await app.register(orderRoutes, { prefix: "/api/orders" });
    await app.register(customerRoutes, { prefix: "/api/customers" });
    await app.register(externalSaleRoutes, { prefix: "/api/external-sales" });
    await app.register(inventoryRoutes, { prefix: "/api/inventory" });

    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });

    const { userService } = await import("../services/user.service.js");
    await userService.createUser({ first_name: "Http", last_name: "Contract", email: LOGIN_EMAIL, password: LOGIN_PASSWORD });
  });

  after(async () => {
    await db("users").where({ email: LOGIN_EMAIL }).del();
    await app.close();
    await closeDatabase();
  });

  describe("login", () => {
    it("sets the session cookie and does not expose the JWT in the body", async () => {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD } });
      assert.strictEqual(res.statusCode, 200);
      const body = res.json();
      assert.strictEqual(body.token, undefined);
      assert.strictEqual(body.user.email, LOGIN_EMAIL);
      assert.strictEqual(body.user.password_hash, undefined);
      assert.ok(res.cookies.some((c) => c.name === "aurasync_token" && c.httpOnly));
    });

    it("answers invalid payloads with 400 instead of 500", async () => {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "not-an-email", password: "x" } });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json().error, "Validation failed");
    });

    it("no longer serves the duplicated /api/login route", async () => {
      const res = await app.inject({ method: "POST", url: "/api/login", payload: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD } });
      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe("pagination is bounded on every list endpoint", () => {
    const listUrls = [
      "/api/orders",
      "/api/customers",
      "/api/external-sales/products",
      "/api/external-sales/customers",
      "/api/inventory",
      "/api/users",
    ];

    for (const url of listUrls) {
      it(`${url} caps limit at 100 and page at >= 1`, async () => {
        const res = await app.inject({
          method: "GET",
          url: `${url}?limit=100000&page=-4`,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        assert.strictEqual(res.statusCode, 200, res.body);
        const body = res.json();
        if (!Array.isArray(body)) {
          assert.strictEqual(body.limit, 100);
          assert.strictEqual(body.page, 1);
        }
      });
    }
  });
});
