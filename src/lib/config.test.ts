import { describe, it } from "node:test";
import assert from "node:assert";
import { isProduction, assertSecureConfig, parseAllowedOrigins, clampLimit } from "./config.js";

describe("config helpers", () => {
  it("detects production", () => {
    assert.strictEqual(isProduction({ NODE_ENV: "production" }), true);
    assert.strictEqual(isProduction({}), false);
  });

  it("accepts real secrets in production", () => {
    assert.doesNotThrow(() => assertSecureConfig({
      NODE_ENV: "production",
      JWT_SECRET: "a-very-long-random-secret-value",
      CSRF_SECRET: "another-very-long-random-secret-value",
    }));
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

  it("falls back to production origin when unset under NODE_ENV=production", () => {
    assert.deepStrictEqual(parseAllowedOrigins({ NODE_ENV: "production" }), ["https://lamata.tec.br"]);
  });

  it("falls back to dev origins when unset", () => {
    assert.deepStrictEqual(parseAllowedOrigins({}), ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"]);
  });

  it("clamps pagination limits", () => {
    assert.strictEqual(clampLimit(undefined, 10), 10);
    assert.strictEqual(clampLimit(999, 10), 100);
    assert.strictEqual(clampLimit(0, 10), 1);
  });
});