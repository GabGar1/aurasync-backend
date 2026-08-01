import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import type { FastifyRequest, FastifyReply } from "fastify";
import { userRoutes } from "./user.router.js";
import { closeDatabase } from "../test/setup.js";
import { db } from "../lib/db.js";

const testEmails = [
  "user.auth.test@aurasync.com",
  "new.user@aurasync.com",
  "delete.auth.test@aurasync.com",
];

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
      reply.status(401).send({ error: "Unauthorized" });
    }
  });
  await app.register(userRoutes, { prefix: "/api" });
  return app;
};

describe("User Router Auth", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;
  let testUserId: string;

  before(async () => {
    await db("users").whereIn("email", testEmails).del();

    app = await buildApp();

    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });

    const { userService } = await import("../services/user.service.js");
    const user = await userService.createUser({
      first_name: "Auth",
      last_name: "Test",
      email: "user.auth.test@aurasync.com",
      password: "TestPassword123!",
    });
    testUserId = user.id as string;
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  describe("POST /users — register", () => {
    const registerBody = {
      first_name: "New",
      last_name: "User",
      email: "new.user@aurasync.com",
      password: "NewUserPass123!",
    };

    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/users",
        body: registerBody,
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: { authorization: `Bearer ${employeeToken}` },
        body: registerBody,
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 201 for ADMIN role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/users",
        headers: { authorization: `Bearer ${adminToken}` },
        body: registerBody,
      });
      assert.strictEqual(res.statusCode, 201);
    });
  });

  describe("PUT /users/:id — update user", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/users/${testUserId}`,
        body: { first_name: "Hacker" },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/users/${testUserId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { first_name: "Should Fail" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/users/${testUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        body: { first_name: "Admin Updated" },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("PUT /users/:id/password — change password", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/users/${testUserId}/password`,
        body: { current_password: "x", new_password: "y" },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/users/${testUserId}/password`,
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { current_password: "TestPassword123!", new_password: "NewPassword456@" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/users/${testUserId}/password`,
        headers: { authorization: `Bearer ${adminToken}` },
        body: { current_password: "TestPassword123!", new_password: "NewPassword456@" },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("DELETE /users/:id — delete user", () => {
    let deleteUserId: string;

    before(async () => {
      const { userService } = await import("../services/user.service.js");
      const user = await userService.createUser({
        first_name: "To Be",
        last_name: "Deleted",
        email: "delete.auth.test@aurasync.com",
        password: "DeletePass123!",
      });
      deleteUserId = user.id as string;
    });

    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/users/${deleteUserId}`,
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/users/${deleteUserId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 204 for ADMIN role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/users/${deleteUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 204);
    });
  });

  describe("GET /users/check-email — check email", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/users/check-email",
        query: { email: "test@example.com" },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/users/check-email",
        headers: { authorization: `Bearer ${employeeToken}` },
        query: { email: "test@example.com" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/users/check-email",
        headers: { authorization: `Bearer ${adminToken}` },
        query: { email: "test@example.com" },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });
});
