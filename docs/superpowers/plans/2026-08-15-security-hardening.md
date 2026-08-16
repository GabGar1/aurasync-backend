# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security findings from the pre-deploy audit: auth on product reads, disabled-user login rejection, fail-fast secret validation, login rate limiting, production defaults (env-driven), security headers, WebSocket auth, error-leak removal, SUPER_ADMIN protection, and deployment docs — without changing the dev workflow.

**Architecture:** Everything is configuration/environment-driven so the same code serves both deployment options (Docker + TLS reverse proxy, or `npm start` behind nginx TLS). Behavior diverges only on `NODE_ENV === 'production'` (+ new `ALLOWED_ORIGINS`/`TRUST_PROXY` vars). New pure helpers live in `src/lib/config.ts` and `src/lib/ws-auth.ts` so they are unit-testable without a running server. Route-level guards are added where the leaked data lives (Product reads, user lifecycle, WebSocket handshake). Security integration tests use the existing `node:test` + `app.inject` router pattern against `aurasync_test`.

**Tech Stack:** Fastify 5, `@fastify/jwt`, `@fastify/cookie`, `@fastify/rate-limit` (new), `@fastify/helmet` (new), `ws`, Knex, `node:test` + `node:assert`, `tsx`.

## Global Constraints

- Same code for both deploy paths: Docker + TLS reverse proxy AND bare `npm start` + nginx. Never hardcode a production-only behavior that needs code edits to switch.
- TDD: write/confirm the failing test first; implement; verify; commit per task.
- `npm test` runs serially against `aurasync_test`. Router security tests follow the existing `buildApp()` + `app.inject` pattern (see `src/routers/order.router.test.ts`).
- `npm run lint` passes; `npx tsc --noEmit` must not gain NEW errors (baseline: the pre-existing `order.service.integration.test.ts:3` `pg` types error is out of scope).
- No comments in code. Match existing style.
- Secrets/placeholders: never commit real secrets. `.env` stays gitignored.
- `NODE_ENV=production` fail-fast: app refuses to boot with missing/placeholder `JWT_SECRET`/`CSRF_SECRET`.
- The `password` minimum becomes 8 in `user.schema.ts` (all existing test passwords are >8 chars).
- New dependencies allowed: `@fastify/rate-limit`, `@fastify/helmet` (user approved adding both).

---

### Task 1: Require authentication on product read routes

**Files:**
- Modify: `src/routers/product.router.ts` — GET `/` (line 38), GET `/:id` (line 70), GET `/slug/:slug` (line 85)
- Test: `src/routers/security.integration.test.ts` (create)

**Interfaces:**
- Consumes: the existing `fastify.authenticate` decorator (same as write routes already use).
- Produces: product reads return `403`/`401` without a valid JWT; any authenticated role (`ADMIN`, `SUPER_ADMIN`, `EMPLOYEE`) may read.
- Root cause: `cost_price`, `packaging_cost`, `stock_quantity`, margin fields were exposed publicly (audit HIGH).

- [ ] **Step 1: Write the failing tests**

Create `src/routers/security.integration.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { FastifyRequest, FastifyReply } from "fastify";
import { productRoutes } from "./product.router.js";
import { closeDatabase } from "../test/setup.js";

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
  await app.register(productRoutes, { prefix: "/api/products" });
  return app;
};

describe("Security: product reads require auth", () => {
  let app: FastifyInstance;
  let employeeToken: string;

  before(async () => {
    app = await buildApp();
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("rejects GET / without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/" });
    assert.strictEqual(res.statusCode, 401);
  });

  it("rejects GET /:id without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/00000000-0000-4000-8000-000000000000" });
    assert.strictEqual(res.statusCode, 401);
  });

  it("allows GET / with any authenticated role", async () => {
    const res = await app.inject({ method: "GET", url: "/api/products/", headers: { authorization: `Bearer ${employeeToken}` } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.products));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: the three new tests FAIL (status `200` instead of `401`, and the third passes but the first two fail).

- [ ] **Step 3: Add `onRequest: [fastify.authenticate]` to the three GET routes**

In `src/routers/product.router.ts`:

Route at line 38 (`GET /`):
```ts
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    schema: {
```

Route at line 70 (`GET /:id`):
```ts
  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
```

Route at line 85 (`GET /slug/:slug`):
```ts
  fastify.get('/slug/:slug', {
    onRequest: [fastify.authenticate],
    schema: { params: z.object({ slug: z.string().min(1) }) },
  }, async (request, reply) => {
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: all three tests PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- src/routers/product.router.ts src/routers/security.integration.test.ts
git add src/routers/product.router.ts src/routers/security.integration.test.ts
git commit -m "security: require auth on product read routes"
```

---

### Task 2: Reject login for disabled users

**Files:**
- Modify: `src/services/user.service.ts:52-66` (`authenticateUser`)
- Test: `src/services/user.service.integration.test.ts` (add one test)

**Interfaces:**
- Consumes: unchanged `UserSchema.login`.
- Produces: `authenticateUser` returns `null` when the matched user has `status === false`, indistinguishable from a bad password (no user enumeration).
- Root cause: a deactivated account could still log in (audit HIGH).

- [ ] **Step 1: Write the failing test**

In `src/services/user.service.integration.test.ts`, add the email `"disabled.login@aurasync.com"` to the `testEmails` array (line 10), then append this test to the end of the file's `describe` block (or its last inner group):

```ts
  it("rejects login for a disabled user", async () => {
    const user = await userService.createUser({
      first_name: "Disabled",
      last_name: "Login",
      email: "disabled.login@aurasync.com",
      password: "DisabledPass123!",
    });
    await db("users").where({ id: user.id }).update({ status: false });

    const result = await userService.authenticateUser({
      email: "disabled.login@aurasync.com",
      password: "DisabledPass123!",
    });
    assert.strictEqual(result, null);
  });
```

`db` is already imported in this file, and the existing `before`/`after` hooks already clean up every address in `testEmails` — no extra cleanup needed.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/services/user.service.integration.test.ts`
Expected: the new test FAILS (`authenticateUser` returns the user object instead of `null`).

- [ ] **Step 3: Implement the status check**

In `src/services/user.service.ts`, inside `authenticateUser`, after the password check (line 60-63), insert:

```ts
    if (!user.status) {
      return null;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/services/user.service.integration.test.ts`
Expected: whole suite PASSES.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- src/services/user.service.ts src/services/user.service.integration.test.ts
git add src/services/user.service.ts src/services/user.service.integration.test.ts
git commit -m "security: reject login for disabled users"
```

---

### Task 3: Fail-fast secrets and env-driven config module

**Files:**
- Create: `src/lib/config.ts`
- Modify: `src/server.ts:1,32-36,113,123`
- Modify: `.env.example`
- Test: `src/lib/config.test.ts` (create)

**Interfaces:**
- Produces:
  - `isProduction(env): boolean` — `env.NODE_ENV === 'production'`.
  - `assertSecureConfig(env): void` — throws in production when `JWT_SECRET`/`CSRF_SECRET` is missing, equals `change-me` placeholder, or is a `dev-` prefixed fallback.
  - `parseAllowedOrigins(env): string[]` — uses `ALLOWED_ORIGINS` (comma-separated) when set; otherwise prod default `['https://lamata.tec.br']`, dev default `['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080']`.
  - `resolveHost(env): string` — `env.HOST || '0.0.0.0'`.
  - `resolveTrustProxy(env): boolean` — `env.TRUST_PROXY === 'true'`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/config.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { isProduction, assertSecureConfig, parseAllowedOrigins } from "./config.js";

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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/lib/config.test.ts`
Expected: FAILS with `Error: Cannot find module './config.js'`.

- [ ] **Step 3: Implement the config module**

Create `src/lib/config.ts`:

```ts
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080'];
const PROD_ORIGINS = ['https://lamata.tec.br'];

export function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

export function assertSecureConfig(env: NodeJS.ProcessEnv): void {
  if (!isProduction(env)) return;
  for (const [key, message] of [['JWT_SECRET', 'JWT_SECRET is required in production'], ['CSRF_SECRET', 'CSRF_SECRET is required in production']] as const) {
    const value = env[key];
    if (!value || value.startsWith('change-me') || value.startsWith('dev-')) {
      throw new Error(message);
    }
  }
}

export function parseAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const raw = env.ALLOWED_ORIGINS;
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return isProduction(env) ? PROD_ORIGINS : DEV_ORIGINS;
}

export function resolveHost(env: NodeJS.ProcessEnv): string {
  return env.HOST || '0.0.0.0';
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv): boolean {
  return env.TRUST_PROXY === 'true';
}

export function shouldExposeDocs(env: NodeJS.ProcessEnv): boolean {
  return !isProduction(env);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/lib/config.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Wire into `server.ts`**

In `src/server.ts`:

- Add import near the top (after `import 'dotenv/config';`):
```ts
import { assertSecureConfig, parseAllowedOrigins, resolveHost, resolveTrustProxy, shouldExposeDocs } from "./lib/config.js";
```

- Immediately after the `const app = Fastify({ logger: true });` line, add:
```ts
assertSecureConfig(process.env);
const allowedOrigins = parseAllowedOrigins(process.env);
```

- Replace the constructor to honor trust proxy in front of the CORS block:
```ts
const app = Fastify({ logger: true, trustProxy: resolveTrustProxy(process.env) });
```

- Delete the old `allowedOrigins` block (lines 34-36) that hardcoded the arrays.

- In `start()` (line 113), replace the host:
```ts
    await app.listen({ port, host: resolveHost(process.env) });
```

- Guard the docs registration (lines 72-94) so they only exist outside production:
```ts
if (shouldExposeDocs(process.env)) {
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'AuraSync API',
        description: 'Documentação oficial do E-commerce Backend',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });
}
```

- Update the startup log on line 123:
```ts
    if (shouldExposeDocs(process.env)) {
      console.log(`📚 Swagger documentation available at http://localhost:${port}/docs`);
    }
```

- [ ] **Step 6: Update `.env.example`**

Append:

```
# Security / deployment
NODE_ENV=development
TRUST_PROXY=false
# Comma-separated list of origins allowed to call this API (CORS).
ALLOWED_ORIGINS=
```

- [ ] **Step 7: Verify and commit**

```bash
npx tsx --test --test-concurrency=1 src/lib/config.test.ts
npx tsc --noEmit
npm run lint
git add src/lib/config.ts src/lib/config.test.ts src/server.ts .env.example
git commit -m "security: fail-fast secrets and env-driven server config"
```

---

### Task 4: Rate-limit login endpoints

**Files:**
- Modify: `src/server.ts` (register `@fastify/rate-limit`)
- Modify: `src/routers/auth.router.ts:9` and `src/routers/user.router.ts:41-42` (route config on `/login`)
- Test: extend `src/routers/security.integration.test.ts`

**Interfaces:**
- Consumes: `@fastify/rate-limit` plugin (new dep). Existing minimal test apps that do NOT register the plugin keep working because route `config` is ignored when the plugin is absent.
- Produces: a global default limit of 100 req/15 min per IP; login limits to 5 req/1 min per IP.

- [ ] **Step 1: Install the dependency**

```bash
npm i @fastify/rate-limit
```

- [ ] **Step 2: Write the failing test**

Append to `src/routers/security.integration.test.ts` (inside the same file; add imports for `authRoutes`, `rateLimit`, and `requireRole` not needed here):

```ts
import { authRoutes } from "./auth.router.js";
import rateLimit from "@fastify/rate-limit";

describe("Security: login rate limit", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
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
    await app.register(rateLimit, { global: false });
    await app.register(authRoutes, { prefix: "/api/auth" });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("rejects the 6th login attempt from the same IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nobody@none.test", password: "wrongpass" },
      });
      statuses.push(res.statusCode);
    }
    assert.strictEqual(statuses[5], 429);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: the rate-limit test FAILS (`statuses[5]` is `401`, not `429`).

- [ ] **Step 4: Implement rate limiting**

In `src/server.ts`, import after the CORS import:
```ts
import rateLimit from "@fastify/rate-limit";
```
Register before any route plugins (after `app.register(fastifyCookie);`):
```ts
app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '15 minutes',
});
```

In `src/routers/auth.router.ts`, add route config to the `/login` route at line 9:
```ts
  app.post("/login", {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: UserSchema.login },
  }, async (request, reply) => {
```

In `src/routers/user.router.ts`, add the same `config` to the `/login` route at lines 41-47:
```ts
  app.post(
    "/login",
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: UserSchema.login,
      },
    },
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: rate-limit test PASSES (6th attempt → `429`).

- [ ] **Step 6: Full test regression check**

Run: `npm test`
Expected: all suites pass (rate-limit route `config` is ignored by test apps that don't register the plugin, so existing `/login` router tests are unaffected).

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add package.json package-lock.json src/server.ts src/routers/auth.router.ts src/routers/user.router.ts src/routers/security.integration.test.ts
git commit -m "security: rate-limit login endpoints"
```

---

### Task 5: Security headers via @fastify/helmet

**Files:**
- Modify: `src/server.ts` (register `@fastify/helmet`)
- Test: extend `src/routers/security.integration.test.ts`

**Interfaces:**
- Consumes: new dep `@fastify/helmet`.
- Produces: all API responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Strict-Transport-Security` (prod), etc. CSP is disabled so Plug-and-play docs (swagger-ui in dev) keep rendering.

- [ ] **Step 1: Install the dependency**

```bash
npm i @fastify/helmet
```

- [ ] **Step 2: Write the failing test**

Append inside `src/routers/security.integration.test.ts`:

```ts
import helmet from "@fastify/helmet";

describe("Security: helmet headers", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
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
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(authRoutes, { prefix: "/api/auth" });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("emits nosniff on every response", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "x@y.z", password: "p" } });
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: new test FAILS (`x-content-type-options` is `undefined`).

- [ ] **Step 4: Implement**

In `src/server.ts`, import after the rate-limit import:
```ts
import helmet from "@fastify/helmet";
```
Add `isProduction` to the existing `config.js` import. Register right after `app.register(fastifyCookie);`:
```ts
app.register(helmet, {
  contentSecurityPolicy: isProduction(process.env)
    ? { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } }
    : false,
});
```

Prod gets a strict CSP (docs are hidden in production, so swagger-ui's inline needs never apply); dev keeps CSP off so `/docs` still renders.

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: new test PASSES. Also verify `/docs` still renders in dev: `npm run dev`, `curl -I localhost:3333/docs` returns 200 (manual step; if it breaks, revisit CSP settings).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add package.json package-lock.json src/server.ts src/routers/security.integration.test.ts
git commit -m "security: add helmet security headers"
```

---

### Task 6: Authenticated WebSocket handshake

**Files:**
- Create: `src/lib/ws-auth.ts`
- Modify: `src/server.ts:116`
- Test: `src/lib/ws-auth.test.ts` (create)

**Interfaces:**
- Consumes: `fastify.jwt.verify(token)` (available from `@fastify/jwt` after registration).
- Produces:
  - `parseCookies(cookieHeader: string | undefined): Record<string, string>`
  - `isAuthenticatedUpgrade(cookieHeader: string | undefined, verify: (token: string) => boolean): boolean` — returns true only when the `aurasync_token` cookie exists and `verify` accepts it.
- Root cause: the WebSocket server accepted any TCP connection (audit MED).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ws-auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/lib/ws-auth.test.ts`
Expected: FAILS with `Cannot find module './ws-auth.js'`.

- [ ] **Step 3: Implement**

Create `src/lib/ws-auth.ts`:

```ts
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export function isAuthenticatedUpgrade(cookieHeader: string | undefined, verify: (token: string) => boolean): boolean {
  const token = parseCookies(cookieHeader)['aurasync_token'];
  if (!token) return false;
  try {
    return verify(token);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Wire into `server.ts`**

Import at the top:
```ts
import { isAuthenticatedUpgrade } from "./lib/ws-auth.js";
```

Replace the `new WebSocketServer` block (lines 116-120) with:

```ts
    const wss = new WebSocketServer({
      server: app.server,
      verifyClient: (info, cb) => {
        const ok = isAuthenticatedUpgrade(
          info.req.headers.cookie,
          (token) => {
            app.jwt.verify(token);
            return true;
          }
        );
        if (!ok) {
          cb(false, 401, 'Unauthorized');
          return;
        }
        cb(true);
      },
    });
```

Note: `app.jwt.verify` is exposed by `@fastify/jwt` (v10) after registration. If the ESLint config flags an unused return, keep the bare call — the throw is the signal.

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/lib/ws-auth.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/lib/ws-auth.ts src/lib/ws-auth.test.ts src/server.ts
git commit -m "security: require valid JWT for websocket handshake"
```

---

### Task 7: No error-message leakage

**Files:**
- Modify: `src/server.ts` (add `setErrorHandler`)
- Modify: `src/routers/webhook.router.ts:37-39` (generic 500, no `details`)
- Test: extend `src/routers/security.integration.test.ts`

**Interfaces:**
- Consumes: `app.setErrorHandler(err, request, reply)`.
- Produces: uncaught handler errors return `{ error: 'Internal server error' }` (HTTP 500) and log the real error server-side. The webhook route stops echoing `error.message`/`error.response.data` back to the caller.
- Root cause: `webhook.router.ts` sent `error.response?.data || error.message` to callers (audit MED, worst case).

- [ ] **Step 1: Write the failing tests**

Append to `src/routers/security.integration.test.ts`:

```ts
describe("Security: error leakage", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
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
    app.setErrorHandler((error, _request, reply) => {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    });
    app.get('/boom', async () => {
      throw new Error('db-password-here');
    });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("does not leak raw error messages", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });
    assert.strictEqual(res.statusCode, 500);
    const body = res.json();
    assert.strictEqual(body.error, 'Internal server error');
    assert.ok(!JSON.stringify(body).includes('db-password-here'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: the error-leak test FAILS (Fastify returns the raw message `db-password-here`).

- [ ] **Step 3: Implement**

In `src/server.ts`, after the `app.decorate("authenticate", ...)` block (line 70), add:

```ts
app.setErrorHandler((error, request, reply) => {
  app.log.error({ err: error, url: request.url }, 'Unhandled error');
  return reply.code(500).send({ error: 'Internal server error' });
});
```

In `src/routers/webhook.router.ts`, replace the catch block (lines 36-39):

```ts
      } catch (error) {
        fastify.log.error({ err: error, event }, 'Webhook processing failed');
        return reply.code(500).send({ error: 'Internal server error' });
      }
```

Also remove the `console.log`/`console.warn` statement bodies that include `request.body` on lines 23 and 32 (keep a safe `console.warn` with only the event name):

Line 23:
```ts
            console.log(`Product deleted event received: ${event}`);
```
Line 32:
```ts
            console.warn(`Unhandled webhook event: ${event}`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: the error-leak test PASSES.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/server.ts src/routers/webhook.router.ts src/routers/security.integration.test.ts
git commit -m "security: return generic errors, stop leaking webhook details"
```

---

### Task 8: Protect SUPER_ADMIN from ADMIN account lifecycle actions

**Files:**
- Modify: `src/routers/user.router.ts` — `PUT /users/:id` (line 130), `DELETE /users/:id` (line 180)
- Test: extend `src/routers/user.router.test.ts` or the security file

**Interfaces:**
- Consumes: `userService.getUserById` to read the target's role.
- Produces: only `SUPER_ADMIN` can update/delete a `SUPER_ADMIN`; `ADMIN` gets `403`. Everything else unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/routers/security.integration.test.ts`:

```ts
import { userRoutes } from "./user.router.js";

describe("Security: SUPER_ADMIN protection", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let superId: string;

  before(async () => {
    app = Fastify();
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
    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    await app.register(userRoutes, { prefix: "/api" });

    const { userService } = await import("../services/user.service.js");
    const sup = await userService.createUser({
      first_name: "Root", last_name: "Super", email: "protect.super@aurasync.com", password: "Sup3rSecret!123",
    });
    superId = sup.id;
    await import("../lib/db.js").then(({ db }) => db("users").where({ id: superId }).update({ role: "SUPER_ADMIN" }));
  });

  after(async () => {
    await import("../lib/db.js").then(({ db }) => db("users").where({ id: superId }).del());
    await app.close();
    await closeDatabase();
  });

  it("blocks ADMIN from deleting a SUPER_ADMIN", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${superId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res.statusCode, 403);
  });
});
```

Note: the user router tests currently build a minimal app for `userRoutes` (see `src/routers/user.router.test.ts`) — this new test lives in the security file to avoid cross-test state.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: FAILS (status `204` instead of `403`).

- [ ] **Step 3: Implement the guard**

In `src/routers/user.router.ts`, inside the `PUT /users/:id` handler (line 142-153), add before calling `updateUser`:

```ts
        const target = await userService.getUserById(request.params.id);
        if (!target) {
          return reply.status(404).send({ error: "User not found" });
        }
        if (target.role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN') {
          return reply.status(403).send({ error: 'Forbidden: cannot modify a SUPER_ADMIN account' });
        }
        const user = await userService.updateUser(request.params.id, request.body);
```

Inside the `DELETE /users/:id` handler (line 191-197), add:

```ts
        const target = await userService.getUserById(request.params.id);
        if (!target) {
          return reply.status(404).send({ error: "User not found" });
        }
        if (target.role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN') {
          return reply.status(403).send({ error: 'Forbidden: cannot delete a SUPER_ADMIN account' });
        }
        const success = await userService.deleteUser(request.params.id);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts`
Expected: PASSES. Also run `npx tsx --test --test-concurrency=1 src/routers/user.router.test.ts` to confirm normal ADMIN/EMPLOYEE flows are unaffected.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- src/routers/user.router.ts src/routers/security.integration.test.ts
git add src/routers/user.router.ts src/routers/security.integration.test.ts
git commit -m "security: only SUPER_ADMIN can modify SUPER_ADMIN accounts"
```

---

### Task 9: Webhook body limit, password min 8, pagination cap

**Files:**
- Modify: `src/routers/webhook.router.ts:6-8` (route `bodyLimit`)
- Modify: `src/schemas/user.schema.ts:7,17,35` (`min(6)` → `min(8)`)
- Modify: `src/routers/product.router.ts:58-62`, `src/routers/inventory.router.ts:36-40`, `src/routers/user.router.ts:98` (clamp `limit`)
- Test: `src/services/user.service.integration.test.ts`, `src/routers/security.integration.test.ts`

**Interfaces:**
- Consumes: Fastify route option `bodyLimit`; a new `clampLimit` helper.
- Produces: webhook body capped at 1 MB; passwords require 8+ chars; list routes cap `limit` at 100.

- [ ] **Step 1: Add the `clampLimit` helper**

In `src/lib/config.ts`, append:

```ts
export function clampLimit(value: number | undefined, fallback: number, max = 100): number {
  const n = value ?? fallback;
  return Math.min(Math.max(1, n), max);
}
```

- [ ] **Step 2: Write the failing tests**

In `src/lib/config.test.ts`, append:

```ts
  it("clamps pagination limits", () => {
    assert.strictEqual(clampLimit(undefined, 10), 10);
    assert.strictEqual(clampLimit(999, 10), 100);
    assert.strictEqual(clampLimit(0, 10), 1);
  });
```
and add `clampLimit` to the import.

In `src/services/user.service.integration.test.ts`, append:

```ts
  it("rejects a short password", async () => {
    await assert.rejects(
      userService.createUser({
        first_name: "Short", last_name: "Pass", email: "short.pass@aurasync.com", password: "1234567",
      }),
      /at least 8 characters/
    );
  });
```

In `src/routers/security.integration.test.ts`, append:

```ts
describe("Security: webhook body limit", () => {
  let app: FastifyInstance;

  before(async () => {
    app = Fastify();
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
    const { webhookRoutes } = await import("./webhook.router.js");
    await app.register(webhookRoutes, { prefix: "/api/webhooks" });
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it("rejects oversized webhook payloads", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/nuvemshop",
      headers: { "x-webhook-event": "product/created", "content-type": "application/json" },
      payload: { data: "x".repeat(2 * 1024 * 1024) },
    });
    assert.strictEqual(res.statusCode, 413);
  });
});
```

Note: the webhook signature middleware (`verifyNuvemshopWebhook`) runs in `preHandler`, after body parsing — a 413 from `bodyLimit` short-circuits before it.

- [ ] **Step 3: Run to verify they fail**

```bash
npx tsx --test --test-concurrency=1 src/lib/config.test.ts
npx tsx --test --test-concurrency=1 src/services/user.service.integration.test.ts
npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts
```
Expected: the new tests FAIL (clamp returns wrong values; short password accepted; webhook returns 200).

- [ ] **Step 4: Implement**

In `src/routers/webhook.router.ts`, add `bodyLimit` to the route options:

```ts
    { preHandler: [verifyNuvemshopWebhook], bodyLimit: 1024 * 1024 },
```

In `src/schemas/user.schema.ts`, replace the three `min(6, '...')` occurrences with `min(8, '... at least 8 characters')` (lines 7, 17, 35) — keep the message text style of each line.

In `src/routers/product.router.ts` (lines 58-62), clamp the limit:
```ts
      const result = await productService.getProducts(
        page ?? 1,
        clampLimit(limit, 10),
        filters
      );
```
and import `clampLimit`:
```ts
import { clampLimit } from "../lib/config.js";
```

In `src/routers/inventory.router.ts` (lines 36-40), clamp `limit`:
```ts
      const history = await inventoryService.getGlobalHistory(
        page ?? 1,
        clampLimit(limit, 50)
      );
```

In `src/routers/user.router.ts` (line 98), clamp `limit`:
```ts
        const result = await userService.getUsers(page, clampLimit(limit, 10), filters);
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx tsx --test --test-concurrency=1 src/lib/config.test.ts
npx tsx --test --test-concurrency=1 src/services/user.service.integration.test.ts
npx tsx --test --test-concurrency=1 src/routers/security.integration.test.ts
```
Expected: all new tests PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npx tsc --noEmit
npm run lint
git add src/lib/config.ts src/lib/config.test.ts src/schemas/user.schema.ts src/routers/webhook.router.ts src/routers/product.router.ts src/routers/inventory.router.ts src/routers/user.router.ts src/services/user.service.integration.test.ts src/routers/security.integration.test.ts
git commit -m "security: body limit, stronger passwords, capped pagination"
```

---

### Task 10: Filesystem-safe Docker/compose defaults + stale log removal

**Files:**
- Modify: `Dockerfile` (add `NODE_ENV=production`, non-root user)
- Modify: `docker-compose.yml` (bind Postgres to 127.0.0.1, creds via env)
- Modify: `src/lib/websocket.ts` (dev console.logs already fine — no change; this task removes the leftover `product/deleted` body `console.log` leftover if any remain)

**Notes on deployment: this task is pure infra — no unit tests. Verification is `docker compose config -q` and `docker build .`.**

- [ ] **Step 1: Harden the Dockerfile**

In `Dockerfile`:

```
FROM node:20-alpine
## docs/superpowers header (kept minimal)
```

Replace the runtime-stage ENV and user (append after line 16 `COPY . .`):

```dockerfile
ENV NODE_ENV=production
ENV PORT=3333
EXPOSE 3333

RUN addgroup -S app && adduser -S app -G app
USER app

CMD ["npm", "run", "start"]
```

- [ ] **Step 2: Harden docker-compose.yml**

Replace `docker-compose.yml` with:

```yaml
services:
  postgres:
    image: postgres:15-alpine
    container_name: aurasync_db
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-admin}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-admin}
      POSTGRES_DB: ${POSTGRES_DB:-aurasync}
    ports:
      - "127.0.0.1:5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

The compose file reads `.env` automatically for substitution; values stay out of git. Binding to `127.0.0.1` keeps Postgres off the public interface.

- [ ] **Step 3: Add CSRF to logout (same task — small)**

In `src/routers/auth.router.ts`, add the CSRF hook to logout (line 55):

```ts
  app.post("/logout", { preHandler: [csrfProtection()] }, async (_request, reply) => {
```

`csrfProtection` is already imported in this file. `GET/HEAD/OPTIONS` bypass it; for other methods it only enforces when a session cookie is present; when no cookie is present it returns early (no-op for unauthenticated clients).

- [ ] **Step 4: Verify infra + tests**

```bash
docker compose config -q
npm test
```
Expected: `docker compose config -q` succeeds (compose file is valid, bind is localhost); full test suite still passes.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml src/routers/auth.router.ts
git commit -m "security: production container defaults, local-only postgres, csrf on logout"
```

---

### Task 11: Deployment documentation

**Files:**
- Create: `docs/DEPLOYMENT.md`

**Interfaces:**

- Produces runnable, copy-paste instructions for BOTH deploy options plus a secret-rotation checklist.

- [ ] **Step 1: Write the docs**

Create `docs/DEPLOYMENT.md`:

```markdown
# AuraSync Backend — Deployment

Both options share the same code. Behavior is controlled by environment variables and `NODE_ENV`.

## Environment variables (all deploy paths)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | prod | must be `production` in production |
| `JWT_SECRET` | prod | session signing secret (>=32 random chars) |
| `CSRF_SECRET` | prod | CSRF token HMAC secret (>=32 random chars) |
| `DATABASE_URL` | yes | Postgres DSN |
| `NUVEMSHOP_STORE_ID` | yes | Nuvemshop store id |
| `NUVEMSHOP_ACCESS_TOKEN` | yes | Nuvemshop API token |
| `NUVEMSHOP_WEBHOOK_SECRET` | yes | webhook HMAC secret |
| `ALLOWED_ORIGINS` | no | comma list; default `https://lamata.tec.br` in prod |
| `TRUST_PROXY` | yes | `true` when behind a reverse proxy (needed for secure cookies + rate limit IPs) |
| `HOST` | no | bind address; `0.0.0.0` in Docker, `127.0.0.1` behind a proxy |
| `PORT` | no | default `3333` |

If `NODE_ENV=production` and `JWT_SECRET`/`CSRF_SECRET` are missing or placeholders, the app refuses to start (fail-fast).

Set `CSRF_SECRET` rotation = optional (see below).

## Option A: Docker + TLS reverse proxy (recommended)

1. Copy `.env.example` to `.env` and fill real values (incl. `NODE_ENV=production`, `TRUST_PROXY=true`, `HOST=0.0.0.0`).
2. Build and run: `docker build -t aurasync-backend . && docker compose up -d`
3. Run migrations: `docker run --rm --env-file .env aurasync-backend npm run db:migrate`  (or a one-off `docker compose run` with the app service)
4. Put Caddy (or nginx) in front with a TLS cert for `lamata.tec.br`, proxying to `127.0.0.1:3333`:
   - `reverse_proxy lamata.tec.br { reverse_proxy 127.0.0.1:3333 }`
5. Postgres lives only on `127.0.0.1:5433` (compose). Migrations run against `DATABASE_URL`.

## Option B: systemd / bare Node + nginx TLS

1. `npm i` and `cp .env.example .env` with real values (`NODE_ENV=production`, `TRUST_PROXY=true`, `HOST=127.0.0.1`).
2. `npm run db:migrate && npm run db:seed`
3. Run with a process manager (pm2/systemd) executing `npm run start`.
4. nginx: terminate TLS for `lamata.tec.br`, `proxy_pass http://127.0.0.1:3333;`, set
   `proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
   (the app needs these because `TRUST_PROXY=true`).

## Webhooks

Nuvemshop must POST to `https://lamata.tec.br/api/webhooks/nuvemshop` with `X-Webhook-Signature: hmac-sha256(secret, body)`.

## Secret rotation

1. Generate a new secret, e.g. `openssl rand -hex 32`.
2. Update `JWT_SECRET`/`CSRF_SECRET` in `.env` (3 accounts will need to re-login; token is 2h).
3. Restart the app; old tokens stop verifying immediately.
4. Rotate `NUVEMSHOP_ACCESS_TOKEN` and `NUVEMSHOP_WEBHOOK_SECRET` in the Nuvemshop dashboard, then update `.env` and restart.
5. Rotate Postgres `POSTGRES_PASSWORD`, update `.env`, recreate the compose env (`docker compose up -d`).

## Post-deploy verification checklist

- [ ] `NODE_ENV=production` visible in `/api/auth/me` context (login works with a real user)
- [ ] `/docs` returns 404 (hidden in production)
- [ ] `GET /api/products/` without Bearer token returns 401
- [ ] All responses include `x-content-type-options: nosniff` (curl -I)
- [ ] Login attempts beyond 5/min from one IP return 429
- [ ] WebSocket at `wss://lamata.tec.br` rejects a connection without the session cookie
- [ ] Unauthenticated/`GET` `OPTIONS` preflight works with `ALLOWED_ORIGINS`
```

- [ ] **Step 2: Verify and commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: add deployment guide for docker and bare-node options"
```

---

### Task 12: Final verification and handoff

**Files:**
- All

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: every suite passes (no new failures).

- [ ] **Step 2: Lint and typecheck**

```bash
npm run lint
npx tsc --noEmit
```
Expected: lint clean; only the pre-existing `order.service.integration.test.ts:3` (`pg` types) error remains.

- [ ] **Step 3: Infrastructure smoke**

```bash
docker compose config -q
docker build -t aurasync-backend-smoke .
```
Expected: compose valid; image builds. (Optional: `docker run --rm aurasync-backend-smoke node -e "require('@fastify/helmets')"` n/a — just confirm the image boots config import by running `docker run --rm -e NODE_ENV=production aurasync-backend-smoke node -e "import('./src/lib/config.js').then(() => process.exit(0))"`.)

- [ ] **Step 4: Review checklist against findings**

- HIGH: product GET auth (Task 1), disabled-user login (Task 2), fail-fast secrets env-driven (Task 3), login rate limit (Task 4), prod defaults/`NODE_ENV`+origins (Task 3/10), Postgres local bind (Task 10) — done.
- MED: helmet headers (Task 5), WebSocket auth (Task 6), `/docs` hidden in prod (Task 3), error/message leak + webhook details (Task 7), inventory already authed (kept), SUPER_ADMIN protection (Task 8), webhook body limit (Task 9), logout CSRF (Task 10).
- LOW: body limit + pagination cap + password min 8 (Task 9), HOST/trustProxy env (Task 3), non-root container user (Task 10), log redaction (Task 7), deployment + rotation docs (Task 11).

- [ ] **Step 5: Commit**

```bash
git status --porcelain
git add -A
git commit -m "security: hardening verification pass" || true
```