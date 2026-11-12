import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { authRoutes } from "./auth.router.js";
import { userRoutes } from "./user.router.js";
import { authenticate } from "../lib/authenticate.js";
import { errorHandler } from "../lib/error-handler.js";
import { deriveCsrfToken } from "../middlewares/csrf.middleware.js";
import { userService } from "../services/user.service.js";
import { closeDatabase } from "../test/setup.js";
import { db } from "../lib/db.js";

const EMAILS = {
  employee: "session.employee@aurasync.com",
  admin: "session.admin@aurasync.com",
  superA: "session.super.a@aurasync.com",
  superB: "session.super.b@aurasync.com",
};
const PASSWORD = "SessionPass123!";

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: "test-secret", cookie: { cookieName: "aurasync_token", signed: false } });
  app.decorate("authenticate", authenticate);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(userRoutes, { prefix: "/api" });
  return app;
}

function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === "aurasync_token");
  assert.ok(cookie, "login must set the session cookie");
  return cookie.value;
}

/** Headers for a cookie session, including the CSRF header mutating routes require. */
function as(token: string) {
  return { cookie: `aurasync_token=${token}`, "x-csrf-token": deriveCsrfToken(token) };
}

describe("Session and account rules", () => {
  let app: FastifyInstance;
  const ids: Record<keyof typeof EMAILS, string> = { employee: "", admin: "", superA: "", superB: "" };
  let otherActiveSupers: string[] = [];

  async function login(email: string, password = PASSWORD): Promise<string> {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    assert.strictEqual(res.statusCode, 200, res.body);
    return sessionCookie(res);
  }

  before(async () => {
    await db("users").whereIn("email", Object.values(EMAILS)).del();
    // "last SUPER_ADMIN" rules need this suite to own every active SUPER_ADMIN of the test DB.
    otherActiveSupers = (await db("users").where({ role: "SUPER_ADMIN", status: true }).whereNull("deleted_at").pluck("id")) as string[];
    if (otherActiveSupers.length) await db("users").whereIn("id", otherActiveSupers).update({ status: false });

    app = await buildApp();
    for (const [key, email] of Object.entries(EMAILS) as Array<[keyof typeof EMAILS, string]>) {
      const role = key === "employee" ? "EMPLOYEE" : key === "admin" ? "ADMIN" : "SUPER_ADMIN";
      const user = await userService.createUser({ first_name: "Session", last_name: key, email, password: PASSWORD, role });
      ids[key] = user.id as string;
    }
  });

  beforeEach(async () => {
    await db("users").whereIn("email", Object.values(EMAILS)).update({ status: true, deleted_at: null });
    await db("users").where({ id: ids.employee }).update({ role: "EMPLOYEE" });
  });

  after(async () => {
    await db("users").whereIn("email", Object.values(EMAILS)).del();
    if (otherActiveSupers.length) await db("users").whereIn("id", otherActiveSupers).update({ status: true });
    await app.close();
    await closeDatabase();
  });

  describe("authenticate", () => {
    it("accepts a fresh session", async () => {
      const token = await login(EMAILS.employee);
      const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: as(token) });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json().email, EMAILS.employee);
    });

    it("rejects tokens signed for users that do not exist", async () => {
      const forged = app.jwt.sign({ sub: "not-a-uuid", role: "SUPER_ADMIN", name: "x", tv: 0 });
      const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: as(forged) });
      assert.strictEqual(res.statusCode, 401);
    });

    it("revokes the session of a deactivated user immediately", async () => {
      const token = await login(EMAILS.employee);
      await db("users").where({ id: ids.employee }).update({ status: false });
      const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: as(token) });
      assert.strictEqual(res.statusCode, 401);
    });

    it("uses the role stored in the database, not the one frozen in the token", async () => {
      const token = await login(EMAILS.employee);
      await db("users").where({ id: ids.employee }).update({ role: "ADMIN" });
      const res = await app.inject({ method: "GET", url: "/api/users?limit=1", headers: as(token) });
      assert.strictEqual(res.statusCode, 200);

      const adminToken = await login(EMAILS.admin);
      await db("users").where({ id: ids.admin }).update({ role: "EMPLOYEE" });
      const denied = await app.inject({ method: "GET", url: "/api/users?limit=1", headers: as(adminToken) });
      assert.strictEqual(denied.statusCode, 403);
      await db("users").where({ id: ids.admin }).update({ role: "ADMIN" });
    });

    it("logout revokes the token even if someone kept a copy", async () => {
      const token = await login(EMAILS.employee);
      const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: as(token) });
      assert.strictEqual(out.statusCode, 200);
      const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: as(token) });
      assert.strictEqual(res.statusCode, 401);
    });
  });

  describe("own password (PUT /api/auth/me/password)", () => {
    it("is available to any role, requires the current password and keeps the caller signed in", async () => {
      const token = await login(EMAILS.employee);

      const wrong = await app.inject({
        method: "PUT", url: "/api/auth/me/password", headers: as(token),
        payload: { current_password: "nope-nope", new_password: "BrandNew123!" },
      });
      assert.strictEqual(wrong.statusCode, 400);

      const res = await app.inject({
        method: "PUT", url: "/api/auth/me/password", headers: as(token),
        payload: { current_password: PASSWORD, new_password: "BrandNew123!" },
      });
      assert.strictEqual(res.statusCode, 200, res.body);
      const renewed = sessionCookie(res);

      assert.strictEqual((await app.inject({ method: "GET", url: "/api/auth/me", headers: as(token) })).statusCode, 401, "old token revoked");
      assert.strictEqual((await app.inject({ method: "GET", url: "/api/auth/me", headers: as(renewed) })).statusCode, 200, "new token works");

      await login(EMAILS.employee, "BrandNew123!");
      await userService.resetPassword(ids.employee, PASSWORD);
    });
  });

  describe("admin password reset (POST /api/users/:id/reset-password)", () => {
    it("lets an ADMIN reset an employee password without knowing it and signs the employee out", async () => {
      const employeeToken = await login(EMAILS.employee);
      const adminToken = await login(EMAILS.admin);

      const res = await app.inject({
        method: "POST", url: `/api/users/${ids.employee}/reset-password`, headers: as(adminToken),
        payload: { new_password: "ResetByAdmin123!" },
      });
      assert.strictEqual(res.statusCode, 200, res.body);
      assert.strictEqual((await app.inject({ method: "GET", url: "/api/auth/me", headers: as(employeeToken) })).statusCode, 401);
      await login(EMAILS.employee, "ResetByAdmin123!");
      await userService.resetPassword(ids.employee, PASSWORD);
    });

    it("does not let an ADMIN reset a SUPER_ADMIN password", async () => {
      const adminToken = await login(EMAILS.admin);
      const res = await app.inject({
        method: "POST", url: `/api/users/${ids.superA}/reset-password`, headers: as(adminToken),
        payload: { new_password: "Whatever123!" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("is not available to employees", async () => {
      const employeeToken = await login(EMAILS.employee);
      const res = await app.inject({
        method: "POST", url: `/api/users/${ids.admin}/reset-password`, headers: as(employeeToken),
        payload: { new_password: "Whatever123!" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("the old PUT /api/users/:id/password route is gone", async () => {
      const adminToken = await login(EMAILS.admin);
      const res = await app.inject({
        method: "PUT", url: `/api/users/${ids.employee}/password`, headers: as(adminToken),
        payload: { current_password: PASSWORD, new_password: "Whatever123!" },
      });
      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe("account protections", () => {
    it("an admin cannot delete or deactivate their own account", async () => {
      const adminToken = await login(EMAILS.admin);
      const del = await app.inject({ method: "DELETE", url: `/api/users/${ids.admin}`, headers: as(adminToken) });
      assert.strictEqual(del.statusCode, 400);
      const off = await app.inject({ method: "PUT", url: `/api/users/${ids.admin}`, headers: as(adminToken), payload: { status: false } });
      assert.strictEqual(off.statusCode, 400);
    });

    it("keeps at least one active SUPER_ADMIN", async () => {
      const superToken = await login(EMAILS.superA);

      // With two active SUPER_ADMINs, demoting one is fine.
      const demote = await app.inject({ method: "PUT", url: `/api/users/${ids.superB}`, headers: as(superToken), payload: { role: "ADMIN" } });
      assert.strictEqual(demote.statusCode, 200, demote.body);

      // superA is now the last one: cannot demote itself...
      const selfDemote = await app.inject({ method: "PUT", url: `/api/users/${ids.superA}`, headers: as(superToken), payload: { role: "ADMIN" } });
      assert.strictEqual(selfDemote.statusCode, 409);

      // ...and nobody can delete or deactivate it through the service either.
      await assert.rejects(userService.deleteUser(ids.superA, ids.superB), /last active SUPER_ADMIN/);
      await assert.rejects(userService.updateUser(ids.superA, { status: false }, ids.superB), /last active SUPER_ADMIN/);

      await db("users").where({ id: ids.superB }).update({ role: "SUPER_ADMIN" });
    });
  });
});
