import { describe, it } from "node:test";
import assert from "node:assert";
import { parseCookies, isAuthenticatedUpgrade } from "./ws-auth.js";

describe("ws-auth", () => {
  it("parses cookies", () => {
    assert.deepStrictEqual(parseCookies("a=1; aurasync_token=abc; b=2"), { a: "1", aurasync_token: "abc", b: "2" });
    assert.deepStrictEqual(parseCookies(undefined), {});
  });

  it("accepts a valid token cookie", async () => {
    const ok = await isAuthenticatedUpgrade("aurasync_token=good.token.here", (t) => t === "good.token.here");
    assert.strictEqual(ok, true);
  });

  it("rejects a missing cookie", async () => {
    const ok = await isAuthenticatedUpgrade(undefined, () => true);
    assert.strictEqual(ok, false);
  });

  it("rejects an invalid token", async () => {
    const ok = await isAuthenticatedUpgrade("aurasync_token=bad", () => false);
    assert.strictEqual(ok, false);
  });

  it("supports async verification (session revoked in the database)", async () => {
    assert.strictEqual(await isAuthenticatedUpgrade("aurasync_token=t", async () => false), false);
    assert.strictEqual(await isAuthenticatedUpgrade("aurasync_token=t", async () => true), true);
  });

  it("treats a failing verification as unauthenticated", async () => {
    const ok = await isAuthenticatedUpgrade("aurasync_token=t", async () => { throw new Error("db down"); });
    assert.strictEqual(ok, false);
  });
});
