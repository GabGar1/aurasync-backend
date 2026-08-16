import { describe, it } from "node:test";
import assert from "node:assert";
import { parseCookies, isAuthenticatedUpgrade } from "./ws-auth.js";

describe("ws-auth", () => {
  it("parses cookies", () => {
    assert.deepStrictEqual(parseCookies("a=1; aurasync_token=abc; b=2"), { a: "1", aurasync_token: "abc", b: "2" });
    assert.deepStrictEqual(parseCookies(undefined), {});
  });

  it("accepts a valid token cookie", () => {
    const ok = isAuthenticatedUpgrade("aurasync_token=good.token.here", (t) => t === "good.token.here");
    assert.strictEqual(ok, true);
  });

  it("rejects a missing cookie", () => {
    const ok = isAuthenticatedUpgrade(undefined, () => true);
    assert.strictEqual(ok, false);
  });

  it("rejects an invalid token", () => {
    const ok = isAuthenticatedUpgrade("aurasync_token=bad", () => false);
    assert.strictEqual(ok, false);
  });
});