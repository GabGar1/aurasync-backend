# Auth for Orders & Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authentication (JWT) and authorization (role-based) guards to all Order and Inventory HTTP endpoints, matching the project's existing security pattern on Product routes.

**Architecture:** Auth is enforced at the Router layer via Fastify `onRequest`/`preHandler` hooks. The `authenticate` decorator (JWT verify) and `requireRole` middleware already exist — no new infrastructure needed. Tests use Fastify's `inject()` for HTTP-level verification, not service-level calls.

**Tech Stack:** Fastify 5, `@fastify/jwt`, `node:test` + `node:assert`, `tsx`

## Global Constraints

- Follow existing patterns: `onRequest: [fastify.authenticate]` for auth-only, add `preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` for admin-required
- Do not modify `server.ts`, existing service tests, or add new dependencies
- Import `requireRole` from `../middlewares/role.middleware.js`
- Tests must use Fastify `app.inject()` at the HTTP level, not service-level calls
- Test tokens generated via `app.jwt.sign()` — no real DB users needed for auth

---

### Task 1: Auth guards on `order.router.ts`

**Files:**
- Modify: `src/routers/order.router.ts`

**Interfaces:**
- Consumes: `requireRole` from `../middlewares/role.middleware.js`
- Produces: All 6 order routes protected per the matrix below

| Route | Guard |
|---|---|
| `POST /` | `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `POST /sync/nuvemshop` | `onRequest: [fastify.authenticate]` |
| `GET /` | `onRequest: [fastify.authenticate]` |
| `GET /:id` | `onRequest: [fastify.authenticate]` |
| `PUT /:id` | `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `DELETE /:id` | `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |

- [ ] **Step 1: Add `requireRole` import**

Add to imports in `src/routers/order.router.ts`:
```typescript
import { requireRole } from "../middlewares/role.middleware.js";
```

- [ ] **Step 2: Guard POST / — create order**

Add `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` to the POST `/` route.

- [ ] **Step 3: Guard POST /sync/nuvemshop**

Add `onRequest: [fastify.authenticate]` to the sync route.

- [ ] **Step 4: Guard GET / — list orders**

Add `onRequest: [fastify.authenticate]` to the list route.

- [ ] **Step 5: Guard GET /:id — get order by ID**

Add `onRequest: [fastify.authenticate]` to the get-by-ID route.

- [ ] **Step 6: Guard PUT /:id — update order**

Add `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` to the update route.

- [ ] **Step 7: Guard DELETE /:id — soft-delete order**

Add `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` to the delete route.

- [ ] **Step 8: Run existing tests to confirm no regression**

```bash
npm test
```
Expected: Existing service-level tests pass (they call services directly, not affected by router auth).

- [ ] **Step 9: Commit**

```bash
git add src/routers/order.router.ts
git commit -m "feat: add auth guards to order routes"
```

---

### Task 2: Auth guards on `inventory.router.ts`

**Files:**
- Modify: `src/routers/inventory.router.ts`

**Interfaces:**
- Consumes: `requireRole` from `../middlewares/role.middleware.js`
- Produces: All 3 inventory routes protected per the matrix below

| Route | Guard |
|---|---|
| `POST /` | `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `GET /variant/:variantId` | `onRequest: [fastify.authenticate]` |
| `GET /` | unchanged (already has `onRequest: [fastify.authenticate]`) |

- [ ] **Step 1: Add `requireRole` import**

```typescript
import { requireRole } from "../middlewares/role.middleware.js";
```

- [ ] **Step 2: Guard POST / — create transaction**

Add `onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` to the POST `/` route.

- [ ] **Step 3: Guard GET /variant/:variantId — variant history**

Add `onRequest: [fastify.authenticate]` to the variant history route.

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/routers/inventory.router.ts
git commit -m "feat: add auth guards to inventory routes"
```

---

### Task 3: Auth tests for order routes

**Files:**
- Create: `src/routers/order.router.test.ts`

**Interfaces:**
- Consumes: `orderRoutes` from `./order.router.js`, `productService` from `../services/product.service.js`, `cleanupDatabase` from `../test/setup.js`
- Produces: HTTP-level auth coverage for all 6 order endpoints

- [ ] **Step 1: Write the test file**

Create `src/routers/order.router.test.ts`:

```typescript
import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { FastifyRequest, FastifyReply } from "fastify";
import { orderRoutes } from "./order.router.js";
import { productService } from "../services/product.service.js";
import { cleanupDatabase } from "../test/setup.js";

const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: "test-secret" });
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Token ausente ou inválido!" });
    }
  });
  await app.register(orderRoutes, { prefix: "/api/orders" });
  return app;
};

describe("Order Router Auth", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;
  let testVariantId: string;
  let testOrderId: string;

  before(async () => {
    await cleanupDatabase();

    app = await buildApp();

    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });

    const product = await productService.createProduct({
      slug: "auth-order-test-product",
      name: "Auth Test Product",
      variants: [{ price: 100, stock_quantity: 50 }],
    });
    testVariantId = product.variants[0]!.id;

    const order = await productService.createProduct({
      slug: "auth-order-test-seed",
      name: "Seed Order Product",
      variants: [{ price: 50, stock_quantity: 10 }],
    });
    testVariantId = order.variants[0]!.id;
  });

  after(async () => {
    await app.close();
    await cleanupDatabase();
  });

  describe("POST / — create order", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        body: { customer_name: "Test", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { customer_name: "Test", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 201 for ADMIN role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { customer_name: "Test Admin", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 100 }] },
      });
      assert.strictEqual(res.statusCode, 201);
      const body = res.json();
      testOrderId = body.id;
    });
  });

  describe("POST /sync/nuvemshop — sync orders", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders/sync/nuvemshop",
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 202 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders/sync/nuvemshop",
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 202);
    });

    it("should return 202 for ADMIN role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders/sync/nuvemshop",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 202);
    });
  });

  describe("GET / — list orders", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/api/orders" });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 200 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/orders",
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/orders",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("GET /:id — get order by ID", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/api/orders/${testOrderId}` });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 200 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("PUT /:id — update order", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/orders/${testOrderId}`,
        body: { customer_name: "Hacker" },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { customer_name: "Should Fail" },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/orders/${testOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        body: { customer_name: "Admin Updated" },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("DELETE /:id — delete order", () => {
    let deleteOrderId: string;

    before(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/orders",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { customer_name: "To Delete", items: [{ variant_id: testVariantId, quantity: 1, unit_price: 50 }] },
      });
      deleteOrderId = res.json().id;
    });

    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "DELETE", url: `/api/orders/${deleteOrderId}` });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/orders/${deleteOrderId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 204 for ADMIN role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/orders/${deleteOrderId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 204);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test
```
Expected: All auth tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/routers/order.router.test.ts
git commit -m "test: auth tests for order routes"
```

---

### Task 4: Auth tests for inventory routes

**Files:**
- Create: `src/routers/inventory.router.test.ts`

**Interfaces:**
- Consumes: `inventoryRoutes` from `./inventory.router.js`, `productService` from `../services/product.service.js`, `cleanupDatabase` from `../test/setup.js`
- Produces: HTTP-level auth coverage for all 3 inventory endpoints

- [ ] **Step 1: Write the test file**

Create `src/routers/inventory.router.test.ts`:

```typescript
import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { FastifyRequest, FastifyReply } from "fastify";
import { inventoryRoutes } from "./inventory.router.js";
import { productService } from "../services/product.service.js";
import { cleanupDatabase } from "../test/setup.js";

const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify();
  await app.register(fastifyJwt, { secret: "test-secret" });
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Token ausente ou inválido!" });
    }
  });
  await app.register(inventoryRoutes, { prefix: "/api/inventory" });
  return app;
};

describe("Inventory Router Auth", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;
  let testVariantId: string;

  before(async () => {
    await cleanupDatabase();

    app = await buildApp();

    adminToken = app.jwt.sign({ sub: "admin-id", role: "ADMIN", name: "Admin" });
    employeeToken = app.jwt.sign({ sub: "emp-id", role: "EMPLOYEE", name: "Employee" });

    const product = await productService.createProduct({
      slug: "auth-inventory-test-product",
      name: "Auth Inventory Test",
      variants: [{ price: 100, stock_quantity: 50 }],
    });
    testVariantId = product.variants[0]!.id;
  });

  after(async () => {
    await app.close();
    await cleanupDatabase();
  });

  describe("POST / — create transaction", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory",
        body: { variant_id: testVariantId, type: "RESTOCK", quantity_changed: 10 },
      });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 403 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${employeeToken}` },
        body: { variant_id: testVariantId, type: "RESTOCK", quantity_changed: 10 },
      });
      assert.strictEqual(res.statusCode, 403);
    });

    it("should return 201 for ADMIN role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${adminToken}` },
        body: { variant_id: testVariantId, type: "RESTOCK", quantity_changed: 10 },
      });
      assert.strictEqual(res.statusCode, 201);
    });
  });

  describe("GET /variant/:variantId — variant history", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/api/inventory/variant/${testVariantId}` });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 200 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/inventory/variant/${testVariantId}`,
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/inventory/variant/${testVariantId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe("GET / — global history", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/api/inventory" });
      assert.strictEqual(res.statusCode, 401);
    });

    it("should return 200 for EMPLOYEE role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${employeeToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it("should return 200 for ADMIN role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/inventory",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test
```
Expected: All auth tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/routers/inventory.router.test.ts
git commit -m "test: auth tests for inventory routes"
```
