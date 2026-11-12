import { describe, it } from "node:test";
import assert from "node:assert";
import { isProduction, assertSecureConfig, parseAllowedOrigins, clampLimit, clampPage, resolveRateLimit } from "./config.js";

const PROD_SECRETS = {
  NODE_ENV: "production",
  JWT_SECRET: "a-very-long-random-secret-value",
  CSRF_SECRET: "another-very-long-random-secret-value",
  ALLOWED_ORIGINS: "https://app.example.com",
};

describe("config helpers", () => {
  it("detects production", () => {
    assert.strictEqual(isProduction({ NODE_ENV: "production" }), true);
    assert.strictEqual(isProduction({}), false);
  });

  it("accepts real secrets in production", () => {
    assert.doesNotThrow(() => assertSecureConfig(PROD_SECRETS));
  });

  it("requires ALLOWED_ORIGINS in production", () => {
    const { ALLOWED_ORIGINS: _omit, ...withoutOrigins } = PROD_SECRETS;
    assert.throws(() => assertSecureConfig(withoutOrigins), /ALLOWED_ORIGINS/);
  });

  it("rejects missing JWT_SECRET in production", () => {
    assert.throws(() => assertSecureConfig({ NODE_ENV: "production", CSRF_SECRET: "x" }), /JWT_SECRET/);
  });

  it("rejects missing CSRF_SECRET in production", () => {
    assert.throws(() => assertSecureConfig({ NODE_ENV: "production", JWT_SECRET: "x" }), /CSRF_SECRET/);
  });

  it("rejects placeholder change-me secrets in production", () => {
    assert.throws(() => assertSecureConfig({
      NODE_ENV: "production",
      JWT_SECRET: "change-me-to-a-random-secret",
      CSRF_SECRET: "x",
    }), /JWT_SECRET/);
  });

  it("does not enforce secrets outside production", () => {
    assert.doesNotThrow(() => assertSecureConfig({}));
  });

  it("parses ALLOWED_ORIGINS as a comma list", () => {
    assert.deepStrictEqual(
      parseAllowedOrigins({ ALLOWED_ORIGINS: "https://a.com, https://b.com" }),
      ["https://a.com", "https://b.com"]
    );
  });

  it("has no hardcoded origin fallback in production", () => {
    assert.deepStrictEqual(parseAllowedOrigins({ NODE_ENV: "production" }), []);
  });

  it("falls back to dev origins when unset", () => {
    assert.deepStrictEqual(parseAllowedOrigins({}), ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"]);
  });

  it("clamps pagination limits", () => {
    assert.strictEqual(clampLimit(undefined, 10), 10);
    assert.strictEqual(clampLimit(999, 10), 100);
    assert.strictEqual(clampLimit(0, 10), 1);
    assert.strictEqual(clampLimit(-5, 10), 1);
  });

  it("clamps pagination pages to a positive integer", () => {
    assert.strictEqual(clampPage(undefined), 1);
    assert.strictEqual(clampPage(0), 1);
    assert.strictEqual(clampPage(-3), 1);
    assert.strictEqual(clampPage(2.7), 2);
    assert.strictEqual(clampPage(7), 7);
  });

  it("uses a generous global rate limit by default", () => {
    assert.deepStrictEqual(resolveRateLimit({}), { max: 300, timeWindow: "1 minute" });
  });

  it("reads the global rate limit from the environment", () => {
    assert.deepStrictEqual(
      resolveRateLimit({ RATE_LIMIT_MAX: "50", RATE_LIMIT_WINDOW: "30 seconds" }),
      { max: 50, timeWindow: "30 seconds" }
    );
    assert.deepStrictEqual(resolveRateLimit({ RATE_LIMIT_MAX: "abc" }).max, 300);
  });
});