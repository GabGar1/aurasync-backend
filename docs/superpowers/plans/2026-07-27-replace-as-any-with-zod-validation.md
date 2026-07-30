# Replace `as any` Casts with Proper Zod Schema Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate all 20 `as any` casts in `src/` by adding Fastify-level Zod schema validation on route params, query strings, and request bodies.

**Architecture:** Register Fastify `schema: { body, querystring, params }` with existing Zod schemas from `src/schemas/`. Follow the pattern already established in `user.router.ts` (which uses `fastify-type-provider-zod` for body/params/querystring validation).

**Tech Stack:** Fastify 5, Zod 4, `fastify-type-provider-zod`

## Global Constraints

- Schemas already exist in `src/schemas/` — reuse them, don't recreate
- The `fastify-type-provider-zod` is already registered in `server.ts` (validatorCompiler/serializerCompiler)
- Do NOT change business logic in service or repository layers

---

### Task 1: Fix product router — add schema validation

**Files:**
- Modify: `src/routers/product.router.ts:8-18,20-29,32-52,54-65,67-78,80-94,96-108`

**Current `as any` casts:** Line 13 (`body as any`), line 34 (`query as any`), line 56 (`params as any`), line 69 (`params as any`), line 86 (`body as any`)

- [ ] **Step 1: Add route schema for `POST /`**

Edit `src/routers/product.router.ts:8-18`:
```
  fastify.post('/', {
    onRequest: [fastify.authenticate],
-   preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
+   preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
+   schema: { body: ProductSchema.create }
  }, async (request, reply) => {
    try {
-     const product = await productService.createProduct(request.body as any);
+     const product = await productService.createProduct(request.body);
```

Add import at top:
```
import { ProductSchema } from '../schemas/product.schema.js';
```

- [ ] **Step 2: Add route schema for `GET /` (query params)**

Edit `src/routers/product.router.ts:32-52`:
```
-   fastify.get('/', async (request, reply) => {
+   fastify.get('/', {
+     schema: {
+       querystring: z.object({
+         page: z.coerce.number().optional(),
+         limit: z.coerce.number().optional(),
+         search: z.string().optional(),
+         category: z.string().optional(),
+         is_active: z.string().optional(),
+       }),
+     },
+   }, async (request, reply) => {
    try:
-     const { page, limit, search, category, is_active } = request.query as any;
+     const { page, limit, search, category, is_active } = request.query;
```

Add import at top:
```
import { z } from "zod";
```

- [ ] **Step 3: Add route schema for `GET /:id` (params)**

Edit `src/routers/product.router.ts:54`:
```
-   fastify.get('/:id', async (request, reply) => {
+   fastify.get('/:id', {
+     schema: {
+       params: z.object({ id: z.string().uuid() }),
+     },
+   }, async (request, reply) => {
```

Remove `const { id } = request.params as { id: string }` on line 56, replace with `const { id } = request.params;`

- [ ] **Step 4: Add route schema for `GET /slug/:slug` (params)**

Edit `src/routers/product.router.ts:67`:
```
-   fastify.get('/slug/:slug', async (request, reply) => {
+   fastify.get('/slug/:slug', {
+     schema: {
+       params: z.object({ slug: z.string().min(1) }),
+     },
+   }, async (request, reply) => {
```

Remove `const { slug } = request.params as { slug: string }` on line 69, replace with `const { slug } = request.params;`

- [ ] **Step 5: Add route schema for `PUT /:id` (params + body)**

Edit `src/routers/product.router.ts:80-94`:
```
  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
-   preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
+   preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
+   schema: {
+     params: z.object({ id: z.string().uuid() }),
+     body: ProductSchema.update,
+   },
  }, async (request, reply) => {
    try:
-     const { id } = request.params as { id: string };
-     const product = await productService.updateProduct(id, request.body as any);
+     const { id } = request.params;
+     const product = await productService.updateProduct(id, request.body);
```

- [ ] **Step 6: Add route schema for `DELETE /:id` (params)**

Edit `src/routers/product.router.ts:96-108`:
```
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
-   preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]
+   preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
+   schema: {
+     params: z.object({ id: z.string().uuid() }),
+   },
  }, async (request, reply) => {
    try:
-     const { id } = request.params as { id: string };
+     const { id } = request.params;
```

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/routers/product.router.ts
git commit -m "refactor: add Zod schema validation to product router, remove as any casts"
```

---

### Task 2: Fix order router — add schema validation

**Files:**
- Modify: `src/routers/order.router.ts:8-15,28-46,48-59,61-72,74-83`

**Current `as any` casts:** Line 10 (`body as any`), line 30 (`query as any`), line 50 (`params as any`), line 64 (`body as any`), line 76 (`params as any`)

- [ ] **Step 1: Add route schema for `POST /`**

Edit `src/routers/order.router.ts:8-15`:
```
-   fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, async (request, reply) => {
+   fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { body: OrderSchema.create } }, async (request, reply) => {
```

Replace `request.body as any` with `request.body` on line 10.

Add import at top:
```
import { OrderSchema } from '../schemas/order.schema.js';
```

- [ ] **Step 2: Add route schema for `GET /`**

Edit `src/routers/order.router.ts:28-46`:
```
-   fastify.get('/', { onRequest: [fastify.authenticate] }, async (request, reply) => {
+   fastify.get('/', { onRequest: [fastify.authenticate], schema: { querystring: z.object({ page: z.coerce.number().optional(), limit: z.coerce.number().optional(), status: z.string().optional(), search: z.string().optional() }) } }, async (request, reply) => {
```

Replace `request.query as any` with `request.query` on line 30.

Add import at top:
```
import { z } from "zod";
```

- [ ] **Step 3: Add route schema for `GET /:id`**

Edit `src/routers/order.router.ts:48`:
```
-   fastify.get('/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
+   fastify.get('/:id', { onRequest: [fastify.authenticate], schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
```

Replace `request.params as { id: string }` with `request.params` on line 50.

- [ ] **Step 4: Add route schema for `PUT /:id`**

Edit `src/routers/order.router.ts:61-72`:
```
-   fastify.put('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, async (request, reply) => {
+   fastify.put('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }), body: OrderSchema.update } }, async (request, reply) => {
```

Replace `request.params as { id: string }` with `request.params` on line 63.
Replace `request.body as any` with `request.body` on line 64.

- [ ] **Step 5: Add route schema for `DELETE /:id`**

Edit `src/routers/order.router.ts:74-83`:
```
-   fastify.delete('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, async (request, reply) => {
+   fastify.delete('/:id', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { params: z.object({ id: z.string().uuid() }) } }, async (request, reply) => {
```

Replace `request.params as { id: string }` with `request.params` on line 76.

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/routers/order.router.ts
git commit -m "refactor: add Zod schema validation to order router, remove as any casts"
```

---

### Task 3: Fix inventory router — add schema validation

**Files:**
- Modify: `src/routers/inventory.router.ts:7-14,16-25,27-40`

**Current `as any` casts:** Line 9 (`body as any`), line 18 (`params as any`), line 31 (`query as any`)

- [ ] **Step 1: Add route schema for `POST /`**

Edit `src/routers/inventory.router.ts:7-14`:
```
-   fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])] }, async (request, reply) => {
+   fastify.post('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { body: InventorySchema.create } }, async (request, reply) => {
```

Replace `request.body as any` with `request.body` on line 9.

Add import at top:
```
import { InventorySchema } from '../schemas/inventory.schema.js';
```

- [ ] **Step 2: Add route schema for `GET /variant/:variantId`**

Edit `src/routers/inventory.router.ts:16-25`:
```
-   fastify.get('/variant/:variantId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
+   fastify.get('/variant/:variantId', { onRequest: [fastify.authenticate], schema: { params: z.object({ variantId: z.string().uuid() }) } }, async (request, reply) => {
```

Replace `request.params as { variantId: string }` with `request.params` on line 18.

Add import at top:
```
import { z } from "zod";
```

- [ ] **Step 3: Add route schema for `GET /` (query params)**

Edit `src/routers/inventory.router.ts:27-40`:
```
-   fastify.get('/', {
-     onRequest: [fastify.authenticate]
-   }, async (request, reply) => {
+   fastify.get('/', { onRequest: [fastify.authenticate], schema: { querystring: z.object({ page: z.coerce.number().optional(), limit: z.coerce.number().optional() }) } }, async (request, reply) => {
```

Replace `request.query as any` with `request.query` on line 31.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/routers/inventory.router.ts
git commit -m "refactor: add Zod schema validation to inventory router, remove as any casts"
```

---

### Task 4: Fix webhook router — remove `body as any`

**Files:**
- Modify: `src/routers/webhook.router.ts:19,29`

- [ ] **Step 1: Replace `as any` casts with typed schemas**

Webhook bodies are untyped Nuvemshop payloads. The cleanest fix is to leave the `as any` on webhook routes since the payload shape is dynamic and the service layer parses it internally. Instead, document this:

```typescript
// Webhook payloads are dynamic Nuvemshop data; typed at the service layer
```

But if you want to remove `as any`, add a minimal schema:

Edit `src/routers/webhook.router.ts`:
```
+ import { z } from "zod";
+ 
+ const WebhookBodySchema = z.record(z.unknown());
```

And add `schema: { body: WebhookBodySchema }` to the route. Then replace `request.body as any` with `request.body`.

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routers/webhook.router.ts
git commit -m "refactor: add schema type for webhook body, remove as any"
```

---

### Task 5: Fix nuvemshop service — remove `as any` in upsert calls

**Files:**
- Modify: `src/services/nuvemshop.service.ts:88,167`

**Context:** `productData` and `orderData` are constructed inline with proper types, then cast with `as any`. The actual schemas exist in the service layer. Type these properly.

- [ ] **Step 1: Type the product data mapping**

The service methods `upsertProductFromNuvemshop` and `upsertOrderFromNuvemshop` accept typed params. Define the mapper functions with proper return types matching the service input types.

This fix is more involved — for now, the `as any` casts here are lower priority since the data is constructed internally, not from user input. Consider this a stretch goal.
