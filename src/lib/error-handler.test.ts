import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { z } from "zod";
import { errorHandler } from "./error-handler.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "./errors.js";

describe("errorHandler", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);
    await app.register(rateLimit, { global: false });

    app.post("/validate", { schema: { body: z.object({ email: z.email() }) } }, async () => ({ ok: true }));
    app.get("/not-found", async () => { throw new NotFoundError("Order not found"); });
    app.get("/bad-request", async () => { throw new BadRequestError("Insufficient stock for this transaction"); });
    app.get("/conflict", async () => { throw new ConflictError("Email already registered"); });
    app.get("/forbidden", async () => { throw new ForbiddenError("Only SUPER_ADMIN can set user roles"); });
    app.get("/boom", async () => { throw new Error("db-password-here"); });
    app.get("/limited", { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } }, async () => ({ ok: true }));
  });

  after(async () => {
    await app.close();
  });

  it("answers schema validation errors with 400 and field details", async () => {
    const res = await app.inject({ method: "POST", url: "/validate", payload: { email: "nope" } });
    assert.strictEqual(res.statusCode, 400);
    const body = res.json();
    assert.strictEqual(body.error, "Validation failed");
    assert.ok(Array.isArray(body.details) && body.details.length > 0);
    assert.strictEqual(body.details[0].field, "email");
  });

  it("maps domain errors to their status and keeps the message", async () => {
    const cases: Array<[string, number, string]> = [
      ["/not-found", 404, "Order not found"],
      ["/bad-request", 400, "Insufficient stock for this transaction"],
      ["/conflict", 409, "Email already registered"],
      ["/forbidden", 403, "Only SUPER_ADMIN can set user roles"],
    ];
    for (const [url, status, message] of cases) {
      const res = await app.inject({ method: "GET", url });
      assert.strictEqual(res.statusCode, status, url);
      assert.deepStrictEqual(res.json(), { error: message });
    }
  });

  it("keeps 429 from the rate limiter", async () => {
    await app.inject({ method: "GET", url: "/limited" });
    const res = await app.inject({ method: "GET", url: "/limited" });
    assert.strictEqual(res.statusCode, 429);
    assert.strictEqual(res.json().error, "Too Many Requests");
  });

  it("masks unexpected errors as 500 without leaking the message", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });
    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.json(), { error: "Internal server error" });
    assert.ok(!res.body.includes("db-password-here"));
  });
});
