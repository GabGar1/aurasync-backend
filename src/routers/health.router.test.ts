import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes } from "./health.router.js";
import { closeDatabase } from "../test/setup.js";

describe("GET /api/health", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    await app.register(healthRoutes, { prefix: "/api/health" });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("answers without authentication and confirms the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.status, "ok");
    assert.strictEqual(body.database, "ok");
    assert.ok(typeof body.uptime_seconds === "number");
  });
});
