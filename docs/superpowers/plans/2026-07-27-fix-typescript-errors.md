# Fix TypeScript Compilation Errors & Schema Bug

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix all 5 TypeScript compilation errors and the known `user.schema.ts` type bug so the project compiles cleanly.

**Architecture:** Three discrete fixes across tsconfig, a middleware, a dashboard service type, and a user schema. Each is independent.

**Tech Stack:** TypeScript 6, Zod 4, Fastify 5

## Global Constraints

- Follow project conventions from AGENTS.md
- No unrelated refactoring

---

### Task 1: Fix tsconfig `module` value

**Files:**
- Modify: `tsconfig.json:10`

**Problem:** `"module": "ES2024"` is not a valid value for the installed TypeScript version. Valid values include `"esnext"`, `"node16"`, `"nodenext"`, `"preserve"`.

- [ ] **Step 1: Read current value**

```bash
grep '"module"' tsconfig.json
```

Expected: `"module": "ES2024"`

- [ ] **Step 2: Change to `"NodeNext"`**

Edit `tsconfig.json:10`:

```
-    "module": "ES2024",
+    "module": "NodeNext",
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: The tsconfig line error is gone. Other errors remain.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json
git commit -m "fix: change tsconfig module to NodeNext (ES2024 not valid)"
```

---

### Task 2: Fix nuvemshop middleware import (`DoneFuncWithErr`)

**Files:**
- Modify: `src/middlewares/nuvemshop.middleware.ts:1,4`

**Problem:** `DoneFuncWithErr` doesn't exist on `'fastify'` in this version. `DoneFuncWithErrOrRes` should be used.

- [ ] **Step 1: Fix the import and type reference**

Edit `src/middlewares/nuvemshop.middleware.ts:1`:

```
- import type { FastifyRequest, FastifyReply, DoneFuncWithErr } from 'fastify';
+ import type { FastifyRequest, FastifyReply, DoneFuncWithErrOrRes } from 'fastify';
```

Edit `src/middlewares/nuvemshop.middleware.ts:4`:

```
- export const verifyNuvemshopWebhook = (req: FastifyRequest, reply: FastifyReply, done: DoneFuncWithErr) => {
+ export const verifyNuvemshopWebhook = (req: FastifyRequest, reply: FastifyReply, done: DoneFuncWithErrOrRes) => {
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: The `DoneFuncWithErr` error is gone.

- [ ] **Step 3: Commit**

```bash
git add src/middlewares/nuvemshop.middleware.ts
git commit -m "fix: replace DoneFuncWithErr with DoneFuncWithErrOrRes in webhook middleware"
```

---

### Task 3: Fix dashboard router `DateRangeParams` type issue

**Files:**
- Modify: `src/services/dashboard.service.ts:3-7`

**Problem:** With `exactOptionalPropertyTypes: true`, `{ days?: number }` means the property can be `number` or absent, but the Zod-parsed query provides `days: number | undefined` (explicit `undefined`), which is incompatible.

- [ ] **Step 1: Change `DateRangeParams` to allow explicit `undefined`**

Edit `src/services/dashboard.service.ts:3-7`:

```
- type DateRangeParams = {
-   days?: number;
-   startDate?: string;
-   endDate?: string;
- };
+ type DateRangeParams = {
+   days?: number | undefined;
+   startDate?: string | undefined;
+   endDate?: string | undefined;
+ };
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit 2>&1`
Expected: Zero errors. Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/services/dashboard.service.ts
git commit -m "fix: allow explicit undefined in DateRangeParams for exactOptionalPropertyTypes"
```

---

### Task 4: Fix `user.schema.ts` — `listResponse.id` typed as `number` instead of `uuid`

**Files:**
- Modify: `src/schemas/user.schema.ts:49`

**Problem:** Known bug documented in AGENTS.md: `listResponse.id` is `z.number()` but DB stores UUID. This will fail at runtime when Zod validates responses.

- [ ] **Step 1: Read the current file to confirm the bug**

```bash
grep -n "id:" src/schemas/user.schema.ts
```

Expected: Line 49 has `id: z.number()`.

- [ ] **Step 2: Fix the type**

Edit `src/schemas/user.schema.ts:49`:

```
-       id: z.number(),
+       id: z.string().uuid(),
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors. Zero total errors.

- [ ] **Step 4: Commit**

```bash
git add src/schemas/user.schema.ts
git commit -m "fix: user.schema listResponse.id should be uuid, not number (known bug)"
```
