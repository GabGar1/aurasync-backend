# Add Missing Auth & Authorization Checks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add authentication and role-based authorization to all unprotected or under-protected endpoints: product GET routes, sync endpoints, user listing, order listing, dashboard.

**Architecture:** Add `onRequest: [fastify.authenticate]` to unauthenticated GET routes, add `requireRole` to sensitive endpoints. Follow existing patterns from `order.router.ts` and `user.router.ts`.

**Tech Stack:** Fastify 5, `@fastify/jwt`, `role.middleware.ts`

## Global Constraints

- Product public GET routes should remain public? **Decision needed** — if the product catalog is meant to be public (e.g., for a storefront), skip auth on GET. If internal-only, add auth.
- All other endpoints: add auth + role checks per AGENTS.md conventions.

---

### Task 1: Add auth to product GET endpoints (or decide to leave public)

**Files:**
- Modify: `src/routers/product.router.ts:32,54,67`

**Context:** `GET /`, `GET /:id`, `GET /slug/:slug` have no auth at all. If products are internal-only, protect them. If they're a public catalog, they're fine.

- [ ] **Step 1: Decide the access model**

If products should be internal-only (typical for admin panel), add auth:

Edit `src/routers/product.router.ts:32`:
```
-   fastify.get('/', async (request, reply) => {
+   fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
```

Edit `src/routers/product.router.ts:54`:
```
-   fastify.get('/:id', async (request, reply) => {
+   fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
```

Edit `src/routers/product.router.ts:67`:
```
-   fastify.get('/slug/:slug', async (request, reply) => {
+   fastify.get('/slug/:slug', { onRequest: [fastify.authenticate] }, async (request, reply) => {
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routers/product.router.ts
git commit -m "fix: add authentication to product GET endpoints"
```

---

### Task 2: Add role checks to product/order sync endpoints

**Files:**
- Modify: `src/routers/product.router.ts:20-22`
- Modify: `src/routers/order.router.ts:17`

**Context:** `/sync/nuvemshop` endpoints have auth but no `requireRole`. Any authenticated user (EMPLOYEE) can trigger full Nuvemshop sync. Should require `['ADMIN', 'SUPER_ADMIN']`.

- [ ] **Step 1: Add `preHandler: [requireRole]` to product sync**

Edit `src/routers/product.router.ts:20-22`:
```
  fastify.post('/sync/nuvemshop', {
-    onRequest: [fastify.authenticate]
+    onRequest: [fastify.authenticate],
+    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
  }, async (request, reply) => {
```

- [ ] **Step 2: Add `preHandler: [requireRole]` to order sync**

Edit `src/routers/order.router.ts:17`:
```
-   fastify.post('/sync/nuvemshop', { onRequest: [fastify.authenticate] }, (request, reply) => {
+   fastify.post('/sync/nuvemshop', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, (request, reply) => {
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routers/product.router.ts src/routers/order.router.ts
git commit -m "fix: require ADMIN/SUPER_ADMIN role for Nuvemshop sync endpoints"
```

---

### Task 3: Add role checks to user listing/details endpoints

**Files:**
- Modify: `src/routers/user.router.ts:66,95-116,192,212,227`

**Context:** `GET /users`, `GET /users/:id`, `GET /users/role/:role`, `GET /users/stats`, `GET /users/check-email` — all have auth but no role checks. Any authenticated user can view all user data.

- [ ] **Step 1: Add `requireRole(['ADMIN', 'SUPER_ADMIN'])` to `GET /users`**

Edit `src/routers/user.router.ts:66-70`:
```
  app.get(
    "/users",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

- [ ] **Step 2: Add `requireRole(['ADMIN', 'SUPER_ADMIN'])` to `GET /users/:id`**

Edit `src/routers/user.router.ts:96-99`:
```
  app.get(
    "/users/:id",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

- [ ] **Step 3: Add `requireRole(['ADMIN', 'SUPER_ADMIN'])` to `GET /users/role/:role`**

Edit `src/routers/user.router.ts:193-200`:
```
  app.get(
    "/users/role/:role",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

- [ ] **Step 4: Add `requireRole(['ADMIN', 'SUPER_ADMIN'])` to `GET /users/stats`**

Edit `src/routers/user.router.ts:213-217`:
```
  app.get(
    "/users/stats",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

- [ ] **Step 5: Add `requireRole(['ADMIN', 'SUPER_ADMIN'])` to `GET /users/check-email`**

Edit `src/routers/user.router.ts:228-234`:
```
  app.get(
    "/users/check-email",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/routers/user.router.ts
git commit -m "fix: add role checks to all user endpoints (require ADMIN/SUPER_ADMIN)"
```

---

### Task 4: Add role checks to dashboard endpoints

**Files:**
- Modify: `src/routers/dashboard.router.ts:17-22,34-39,51-56`

**Context:** Dashboard exposes business analytics (revenue, stock, marketing). Any authenticated user can access it.

- [ ] **Step 1: Add `preHandler: [requireRole]` to all three dashboard routes**

Edit each route in `src/routers/dashboard.router.ts`:

Route `GET /dashboard/stock` (line 18):
```
  app.get(
    "/dashboard/stock",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

Route `GET /dashboard/marketing` (line 35):
```
  app.get(
    "/dashboard/marketing",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

Route `GET /dashboard/orders` (line 52):
```
  app.get(
    "/dashboard/orders",
    {
      onRequest: [app.authenticate],
+     preHandler: [requireRole(["ADMIN", "SUPER_ADMIN"])],
```

Also add the import at the top of the file:
```
  import { requireRole } from "../middlewares/role.middleware.js";
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routers/dashboard.router.ts
git commit -m "fix: add ADMIN/SUPER_ADMIN role check to dashboard endpoints"
```

---

### Task 5: Add role checks to order listing/detail endpoints

**Files:**
- Modify: `src/routers/order.router.ts:28,48`

**Context:** Order GET endpoints have auth but no role checks. Any authenticated user can view all orders.

- [ ] **Step 1: Add `preHandler: [requireRole]` to `GET /orders`**

Edit `src/routers/order.router.ts:28`:
```
-   fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
+   fastify.get('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, async (request, reply) => {
```

- [ ] **Step 2: Add `preHandler: [requireRole]` to `GET /orders/:id`**

Edit `src/routers/order.router.ts:48`:
```
-   fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
+   fastify.get('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, async (request, reply) => {
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routers/order.router.ts
git commit -m "fix: add ADMIN/SUPER_ADMIN role check to order GET endpoints"
```
