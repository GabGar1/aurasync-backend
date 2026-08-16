# Fix WIP Failing Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3 pre-existing failing integration tests pass by fixing two real application bugs (non-idempotent month close; stale subgroup links after soft-delete) and the cost-closing suite's cross-test coupling.

**Architecture:** Fixes live in the Repository layer only (`cost-closing.repository.ts`, `product-subgroup.repository.ts`) plus one known-quirk removal convention (see AGENTS: `applicable` month close must be authoritative). The cost engine gets a defensive join so simulated costs never read soft-deleted subgroups. Tests are real integration tests against `aurasync_test`.

**Tech Stack:** Node + TypeScript (ESM), Knex (pg), `node:test` + `node:assert`, `tsx`.

## Global Constraints

- Tests run against `aurasync_test` only; never touch the dev DB. Serial: `npm test` uses `--test-concurrency=1`; always reproduce with that flag.
- Multi-table writes MUST use `db.transaction(...)`. Only the Repository touches Knex.
- Soft delete convention: set `deleted_at`; never hard delete. Tests hard-delete only their own artifacts in `after`.
- TDD: write/confirm the failing test first, see it fail, implement, see it pass, commit.
- No new `tsc --noEmit` errors. Baseline (4 pre-existing, all in WIP test files): `cost.service.integration.test.ts:169,177` (`quantity` missing), `product-subgroup.service.integration.test.ts:105` (possibly-undefined), `order.service.integration.test.ts:3` (`pg` types — out of scope, accept).
- Run `npm run lint` on touched files before committing. No comments in code.

---

### Task 1: Make month close idempotent and isolate the cost-closing suite

**Files:**
- Modify: `src/repositories/cost-closing.repository.ts:63-100` (`applyAllocations`)
- Modify: `src/services/cost-closing.service.integration.test.ts:1-10` (imports + suite hooks)
- Test: `src/services/cost-closing.service.integration.test.ts`

**Interfaces:**
- Consumes: `costClosingService.closeMonth({ month })` → `{ period, components, orders, products, allocations }` (unchanged).
- Produces: `applyAllocations(allocations, start, end)` deletes the whole period's rows and re-inserts the freshly computed set, then recomputes `orders.monthly_cost_total` for **every** order in the period (0 when no allocation remains).
- Root cause: `applyAllocations` currently deletes only rows where `cost_component_id = '00000000-0000-4000-8000-000000000000'` (a sentinel that never matches a real row). Re-closing a month therefore keeps the old rows and re-inserts them → unique violation `order_monthly_allocations_order_id_cost_component_id_period_sta...`. It also never zeroes orders whose allocations were removed. Additionally the suite's two tests share one DB (no per-test truncation) so the first test's August rows leak into the second, breaking its `before === 2` count.

- [ ] **Step 1: Confirm the failing test (red)**

Run: `npx tsx --test --test-concurrency=1 src/services/cost-closing.service.integration.test.ts`
Expected: `removes stale allocations for deactivated components on re-close` FAILS with duplicate key value violates unique constraint `order_monthly_allocations_order_id_cost_component_id_period_sta` (code 23505). The suite's other test passes.

- [ ] **Step 2: Implement the idempotent `applyAllocations`**

In `src/repositories/cost-closing.repository.ts`, replace the body of `applyAllocations` (lines 63-100) with:

```ts
  async applyAllocations(
    allocations: Array<{ order_id: string; cost_component_id: string; amount: number }>,
    start: string,
    end: string
  ) {
    return await db.transaction(async (trx) => {
      await trx('order_monthly_allocations')
        .where('period_start', start)
        .where('period_end', end)
        .del();

      if (allocations.length > 0) {
        await trx('order_monthly_allocations').insert(
          allocations.map((a) => ({
            order_id: a.order_id,
            cost_component_id: a.cost_component_id,
            amount: a.amount,
            period_start: start,
            period_end: end,
          }))
        );
      }

      const periodOrders = await trx('orders')
        .whereNull('deleted_at')
        .where('status', '<>', 'CANCELED')
        .where('created_at', '>=', start)
        .andWhere('created_at', '<', end)
        .select('id');

      const perOrder = await trx('order_monthly_allocations')
        .where('period_start', start)
        .where('period_end', end)
        .groupBy('order_id')
        .select('order_id', db.raw('COALESCE(SUM(amount), 0)::float8 as total'));

      const totalsByOrder = new Map((perOrder as any[]).map((r) => [r.order_id, Number(r.total)]));

      for (const row of periodOrders as any[]) {
        await trx('orders').where({ id: row.id }).update({
          monthly_cost_total: totalsByOrder.get(row.id) ?? 0,
          updated_at: new Date(),
        });
      }
    });
  }
```

Behavior: closing (or re-closing) a month now computes the **authoritative** allocation set — stale rows for deactivated components are removed and affected orders get their `monthly_cost_total` recomputed (0 when nothing remains). No other code writes `order_monthly_allocations`, so delete-then-insert is safe.

- [ ] **Step 3: Isolate the two tests in the suite**

In `src/services/cost-closing.service.integration.test.ts`:

Change the import on line 1 to:

```ts
import { describe, it, before, beforeEach, after } from "node:test";
```

Add a per-test truncation hook right after the `before` hook (line 9):

```ts
  beforeEach(async () => { await cleanupDatabase(); });
```

This guarantees each test starts from a clean DB (the two tests are independent; neither depends on the other's data).

- [ ] **Step 4: Verify the suite passes (green)**

Run: `npx tsx --test --test-concurrency=1 src/services/cost-closing.service.integration.test.ts`
Expected: both tests PASS (including `removes stale allocations for deactivated components on re-close`, whose `before === 2`, `after === 0`, and `monthly_cost_total === 0` assertions now hold).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- src/repositories/cost-closing.repository.ts src/services/cost-closing.service.integration.test.ts
git add src/repositories/cost-closing.repository.ts src/services/cost-closing.service.integration.test.ts
git commit -m "fix: make month close idempotent and isolate cost-closing tests"
```

---

### Task 2: Clear `products.subgroup_id` on subgroup soft-delete

**Files:**
- Modify: `src/repositories/product-subgroup.repository.ts:30-35` (`softDelete`)
- Test: `src/services/product-subgroup.service.integration.test.ts:79-91` ("clears subgroup_id from products when a subgroup is soft-deleted")
- Test: `src/services/cost.service.integration.test.ts:182-202` ("does not apply components of a soft-deleted subgroup to costs")

**Interfaces:**
- Consumes: `productSubgroupService.deleteSubgroup(id)` (unchanged signature, still returns boolean).
- Produces: `ProductSubgroupRepository.softDelete(id)` now also nulls `products.subgroup_id` for non-deleted products of that subgroup, inside one transaction.
- Root cause: `softDelete` only sets `product_subgroups.deleted_at`/`is_active`. `products.subgroup_id` keeps pointing at the soft-deleted subgroup, so `simulateCosts` (which reads `products.subgroup_id`) still applies that subgroup's cost components (`5 !== 0`), and the direct assertion that products get `subgroup_id = null` fails. The DB FK is `ON DELETE SET NULL`, but that only fires on hard delete, which we never do.

- [ ] **Step 1: Confirm both failing tests (red)**

Run: `npx tsx --test --test-concurrency=1 src/services/product-subgroup.service.integration.test.ts`
Expected: `clears subgroup_id from products when a subgroup is soft-deleted` FAILS — `assert.strictEqual(r1.subgroup_id, null)` receives a UUID.

Run: `npx tsx --test --test-concurrency=1 src/services/cost.service.integration.test.ts`
Expected: `does not apply components of a soft-deleted subgroup to costs` FAILS — `5 !== 0`.

- [ ] **Step 2: Implement the transactional soft-delete**

In `src/repositories/product-subgroup.repository.ts`, replace `softDelete` (lines 30-35) with:

```ts
  async softDelete(id: string) {
    return await db.transaction(async (trx) => {
      const result = await trx(this.table)
        .where({ id }).whereNull('deleted_at')
        .update({ deleted_at: new Date(), is_active: false, updated_at: new Date() });
      if (result > 0) {
        await trx('products')
          .where({ subgroup_id: id })
          .whereNull('deleted_at')
          .update({ subgroup_id: null, updated_at: new Date() });
      }
      return result > 0;
    });
  }
```

Two-table write → transaction (AGENTS). Only non-deleted products are unassigned; soft-deleted products are filtered from all reads anyway.

- [ ] **Step 3: Verify both suites pass (green)**

```bash
npx tsx --test --test-concurrency=1 src/services/product-subgroup.service.integration.test.ts
npx tsx --test --test-concurrency=1 src/services/cost.service.integration.test.ts
```

Expected: both commands report PASS for the whole suite (and every subtest).

- [ ] **Step 4: Lint and commit**

```bash
npm run lint -- src/repositories/product-subgroup.repository.ts
git add src/repositories/product-subgroup.repository.ts
git commit -m "fix: unassign products from soft-deleted subgroups"
```

---

### Task 3: Defensive — cost engine never reads soft-deleted subgroups

**Files:**
- Modify: `src/repositories/cost.repository.ts:245-265` (`getComponentsBySubgroupIds`)
- Modify: `src/services/cost.service.integration.test.ts` (add `db` import + one new test)
- Test: new `ignores subgroup cost components when product still points to a soft-deleted subgroup`

**Interfaces:**
- Consumes: `costService.simulateCosts({ variant_id, unit_price, quantity })` → `CostSchema.simulateResponse` (unchanged).
- Produces: `CostRepository.getComponentsBySubgroupIds(subgroupIds, trx?)` joins `product_subgroups` and excludes soft-deleted ones.
- Root cause (defense-in-depth): even with Task 2, legacy rows could still point at a soft-deleted subgroup. `getComponentsBySubgroupIds` never checks `product_subgroups.deleted_at`, so stale links would resurrect removed costs. `subgroup_cost_components` has no `deleted_at` of its own, so the check must come from the `product_subgroups` join.

- [ ] **Step 1: Write the failing test**

Append this test as the last `it(...)` inside the `describe` block of `src/services/cost.service.integration.test.ts` (after the existing `does not apply components of a soft-deleted subgroup to costs` test on line 202):

```ts
  it("ignores subgroup cost components when product still points to a soft-deleted subgroup", async () => {
    const sg = await productSubgroupService.createSubgroup({ name: "Subgrupo Stale" });
    const comp = await costService.createComponent({ name: "Caixa Stale", type: "FIXED", value: 4 });
    await costService.associateSubgroupBatch({ subgroup_id: sg.id, cost_component_ids: [comp.id], quantity: 1 });

    const product = await productService.createProduct({
      slug: "cost-engine-stale-subgroup",
      name: "Cost Engine Stale Subgroup",
      variants: [{ price: 100, stock_quantity: 10 }],
    });
    await productSubgroupService.assignProductsToSubgroup(sg.id, [product.id]);
    const variantId = product.variants[0]!.id;

    await productSubgroupService.deleteSubgroup(sg.id);
    // simulate a legacy record that still references the deleted subgroup
    await db('products').where({ id: product.id }).update({ subgroup_id: sg.id });

    const after = await costService.simulateCosts({ variant_id: variantId, unit_price: 100, quantity: 1 });
    assert.strictEqual(Number(after!.unit_total_cost), 0);
  });
```

Add the missing import at the top of the file (after the `productSubgroupService` import):

```ts
import { db } from "../lib/db.js";
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test --test-concurrency=1 src/services/cost.service.integration.test.ts`
Expected: the new test FAILS — `4 !== 0` (the stale subgroup's FIXED component is still applied).

- [ ] **Step 3: Implement the filtered lookup**

In `src/repositories/cost.repository.ts`, inside `getComponentsBySubgroupIds`, change the query to join `product_subgroups` and filter soft-deleted ones:

```ts
    return query('subgroup_cost_components')
      .whereIn('subgroup_cost_components.subgroup_id', subgroupIds)
      .join('cost_components', 'cost_components.id', 'subgroup_cost_components.cost_component_id')
      .join('product_subgroups', 'product_subgroups.id', 'subgroup_cost_components.subgroup_id')
      .whereNull('cost_components.deleted_at')
      .whereNull('product_subgroups.deleted_at')
      .select(
```

(The existing `.select(...)` list and trailing pieces are unchanged.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx tsx --test --test-concurrency=1 src/services/cost.service.integration.test.ts`
Expected: entire suite PASSES, including the new test.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- src/repositories/cost.repository.ts src/services/cost.service.integration.test.ts
git add src/repositories/cost.repository.ts src/services/cost.service.integration.test.ts
git commit -m "fix: ignore cost components of soft-deleted subgroups in cost engine"
```

---

### Task 4: Restore type safety in the touched WIP test files

**Files:**
- Modify: `src/services/cost.service.integration.test.ts:169,177`
- Modify: `src/services/product-subgroup.service.integration.test.ts:105`

**Interfaces:**
- Consumes: nothing.
- Produces: no `tsc --noEmit` errors in these two files (the two `cost.service` tests already pass at runtime; this is a type-level fix only).

- [ ] **Step 1: Add the zod-defaulted `quantity` to the two batch calls**

In `src/services/cost.service.integration.test.ts`, line 169:

```ts
      costService.associateProductBatch({ product_id: productId, cost_component_ids: ["00000000-0000-4000-8000-0000000000ff"], quantity: 1 }),
```

Line 177:

```ts
      costService.associateProductBatch({ product_id: productId, cost_component_ids: [dupComponent.id, dupComponent.id], quantity: 1 }),
```

- [ ] **Step 2: Fix the possibly-undefined index access**

In `src/services/product-subgroup.service.integration.test.ts`, line 105:

```ts
    assert.strictEqual(parsedList.products[0]!.subgroup_id, sg.id);
```

- [ ] **Step 3: Verify typecheck (no new errors)**

Run: `npx tsc --noEmit`
Expected: only the pre-existing `order.service.integration.test.ts:3` error remains (`pg` types, out of scope). The four WIP-file errors are gone.

- [ ] **Step 4: Commit**

```bash
git add src/services/cost.service.integration.test.ts src/services/product-subgroup.service.integration.test.ts
git commit -m "test: restore type safety in WIP integration tests"
```

---

### Task 5: Full-suite verification

**Files:**
- Test: full suite via `npm test`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (previously `146 pass / 3 fail`; now all 150 tests pass — the 3 fixed plus the new defense-in-depth test added in Task 3).

- [ ] **Step 2: Lint the whole project**

Run: `npm run lint`
Expected: clean (no errors/warnings introduced).

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: only the one out-of-scope pre-existing error in `order.service.integration.test.ts:3`.

- [ ] **Step 4: Commit any straggler changes and finish**

```bash
git status --porcelain
git add -A
git commit -m "test: fix WIP failing suites" || true
```