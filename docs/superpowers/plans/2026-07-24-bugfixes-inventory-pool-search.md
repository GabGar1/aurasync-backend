# Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix user search column mismatch, DB pool idle timeout, missing stock deduction on order creation, and race conditions in inventory updates.

**Architecture:** Four independent fixes across user, DB config, inventory, and order layers. Each fix is self-contained. The stock deduction and concurrency fixes share the `FOR UPDATE` locking pattern and a CHECK constraint migration.

**Tech Stack:** Knex (pg), Fastify, Node:test, Zod

## Global Constraints

- Import paths use `.js` extension (ESM)
- Migration timestamp format: `YYYYMMDDHHMMSS`
- Tests must hard-delete artifacts in `after` hooks
- `FOR UPDATE` locking via Knex's `.forUpdate()` method
- The `inventory_transactions` table already exists (migration `20260324213029_init_database.ts:72-82`)

---

### Task 1: Fix user search column mismatch

**Files:**
- Modify: `src/repositories/user.repository.ts:114-118`
- Test: `src/services/user.service.integration.test.ts`

**Interfaces:**
- Consumes: `filters.search` string from `UserRepository.findAll()`
- Produces: Correct search across `first_name` and `last_name` columns

- [ ] **Step 1: Write the failing test**

Add a new describe block at the end of `src/services/user.service.integration.test.ts`:

```typescript
describe("6. Search Users", () => {
  it("should find users by first name when searching", async () => {
    const { userService } = await import("../services/user.service.js");
    const user = await userService.createUser({
      first_name: "Searchable",
      last_name: "User",
      email: "searchable.user@aurasync.com",
      password: "SearchPass123!",
    });

    const result = await userService.getUsers(1, 10, { search: "Searchable" });
    assert.ok(result.users.length >= 1);
    assert.ok(result.users.some(u => u.id === user.id));
  });

  it("should find users by last name when searching", async () => {
    const result = await userService.getUsers(1, 10, { search: "User" });
    assert.ok(result.users.length >= 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: The new search tests fail (they return no results because `'name'` column doesn't exist).

- [ ] **Step 3: Fix the column reference**

In `src/repositories/user.repository.ts:114-118`, change:

```typescript
if (filters.search) {
  query = query.where((builder: Knex.QueryBuilder) => {
    builder.where('name', 'ilike', `%${filters.search}%`)
      .orWhere('email', 'ilike', `%${filters.search}%`);
  });
}
```

To:

```typescript
if (filters.search) {
  query = query.where((builder: Knex.QueryBuilder) => {
    builder.where('first_name', 'ilike', `%${filters.search}%`)
      .orWhere('last_name', 'ilike', `%${filters.search}%`)
      .orWhere('email', 'ilike', `%${filters.search}%`);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: New search tests pass. All other tests still pass (63/68 total, 5 pre-existing ProductService failures).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/user.repository.ts src/services/user.service.integration.test.ts
git commit -m "fix: correct user search to use first_name/last_name instead of non-existent name column"
```

---

### Task 2: Fix database connection pool idle timeout

**Files:**
- Modify: `knexfile.ts:11-15`

- [ ] **Step 1: Update pool configuration**

In `knexfile.ts`, change:

```typescript
pool: {
  min: 0,
  max: 10,
  idleTimeoutMillis: 100
}
```

To:

```typescript
pool: {
  min: 2,
  max: 10,
  idleTimeoutMillis: 30000
}
```

- [ ] **Step 2: Verify tests still pass**

Run: `npm test`
Expected: No change in test behavior (63/68 pass).

- [ ] **Step 3: Commit**

```bash
git add knexfile.ts
git commit -m "fix: increase pool idleTimeoutMillis from 100ms to 30s and min from 0 to 2"
```

---

### Task 3: Add FOR UPDATE locking and CHECK constraint for inventory

**Files:**
- Modify: `src/repositories/inventory.repository.ts:26-28`
- Create: `src/database/migrations/20260724220000_add_stock_check.ts`
- Test: `src/services/order.service.integration.test.ts`

**Interfaces:**
- Produces: `inventoryRepository.createTransaction()` now uses `SELECT ... FOR UPDATE`

- [ ] **Step 1: Add FOR UPDATE to inventory repository**

In `src/repositories/inventory.repository.ts:26-28`, change:

```typescript
const variant = await trx('product_variants')
  .where({ id: data.variant_id })
  .first();
```

To:

```typescript
const [variant] = await trx('product_variants')
  .where({ id: data.variant_id })
  .forUpdate();
```



- [ ] **Step 2: Create the CHECK constraint migration**

Create `src/database/migrations/20260724220000_add_stock_check.ts`:

```typescript
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE product_variants ADD CONSTRAINT stock_non_negative CHECK (stock_quantity >= 0)'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS stock_non_negative'
  );
}
```

Run the migration: `npm run db:migrate`

- [ ] **Step 3: Run tests to verify no regressions**

Run: `npm test`
Expected: 63/68 pass (no change). Inventory transactions still work correctly.

- [ ] **Step 4: Commit**

```bash
git add src/repositories/inventory.repository.ts src/database/migrations/20260724220000_add_stock_check.ts
git commit -m "fix: add FOR UPDATE locking to inventory transactions and CHECK constraint on stock"
```

---

### Task 4: Add stock deduction to order creation + tests

**Files:**
- Modify: `src/repositories/order.repository.ts:82-107`
- Test: `src/services/order.service.integration.test.ts`

**Interfaces:**
- Consumes: `Knex.Transaction` for atomic multi-table writes
- Produces: `orderRepository.create()` now deducts stock and creates `inventory_transactions`

- [ ] **Step 1: Write the failing tests**

Add the import for `db` at the top of `src/services/order.service.integration.test.ts`:

```typescript
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase } from "../test/setup";
```

Then add this new describe block as the last child inside the existing `describe("OrderService Integration Tests", ...)` block:

```typescript
  // --- STOCK DEDUCTION ---
  describe("6. Stock Deduction on Order Creation", () => {
    let stockTestVariantId: string;

    before(async () => {
      const product = await productService.createProduct({
        slug: "stock-deduction-test",
        name: "Stock Deduction Test",
        variants: [{ price: 100, stock_quantity: 20 }],
      });
      stockTestVariantId = product.variants[0]!.id;
    });

    after(async () => {
      await db("product_variants").where({ id: stockTestVariantId }).del();
      await db("products").where({ slug: "stock-deduction-test" }).del();
    });

    it("should deduct stock when order is created", async () => {
      const order = await orderService.createOrder({
        customer_name: "Stock Test",
        items: [{ variant_id: stockTestVariantId, quantity: 5, unit_price: 100 }],
      });

      assert.ok(order);

      const variant = await db("product_variants")
        .where({ id: stockTestVariantId })
        .first();
      assert.strictEqual(variant.stock_quantity, 15);

      const tx = await db("inventory_transactions")
        .where({ variant_id: stockTestVariantId, order_id: order.id })
        .first();
      assert.ok(tx);
      assert.strictEqual(tx.quantity_changed, -5);
      assert.strictEqual(tx.type, "SALE");
    });

    it("should throw error when insufficient stock", async () => {
      await assert.rejects(
        async () => {
          await orderService.createOrder({
            customer_name: "Over Order",
            items: [{ variant_id: stockTestVariantId, quantity: 100, unit_price: 100 }],
          });
        },
        (err: Error) => {
          assert.ok(err.message.includes("Insufficient stock"));
          return true;
        }
      );

      const variant = await db("product_variants")
        .where({ id: stockTestVariantId })
        .first();
      assert.strictEqual(variant.stock_quantity, 15);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: New stock deduction tests fail because `orderRepository.create()` doesn't deduct stock yet.

- [ ] **Step 3: Implement stock deduction in order creation**

In `src/repositories/order.repository.ts`, modify the `create()` method. Add after the order items are inserted but before the transaction returns:

```typescript
async create(data: CreateOrderInput): Promise<OrderWithItems> {
  const { items, ...orderData } = data;

  return await db.transaction(async (trx) => {
    const [order] = await trx(this.ordersTable)
      .insert({
        ...orderData,
        status: orderData.status || 'PENDING'
      })
      .returning('*');

    const itemsToInsert = items.map(item => ({
      ...item,
      order_id: order.id
    }));

    const insertedItems = await trx(this.itemsTable)
      .insert(itemsToInsert)
      .returning('*');

    // NEW: Deduct stock for each order item
    for (const item of items) {
      const variant = await trx('product_variants')
        .where({ id: item.variant_id })
        .forUpdate()
        .first();

      if (!variant) {
        throw new Error(`Product variant ${item.variant_id} not found`);
      }

      if (variant.stock_quantity < item.quantity) {
        throw new Error(
          `Insufficient stock for variant ${item.variant_id}. Available: ${variant.stock_quantity}, requested: ${item.quantity}`
        );
      }

      await trx('product_variants')
        .where({ id: item.variant_id })
        .update({
          stock_quantity: variant.stock_quantity - item.quantity,
          updated_at: new Date(),
        });

      await trx('inventory_transactions')
        .insert({
          variant_id: item.variant_id,
          order_id: order.id,
          quantity_changed: -item.quantity,
          type: 'SALE',
        });
    }

    return {
      ...order,
      items: insertedItems
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: New stock deduction tests pass. All other tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/order.repository.ts src/services/order.service.integration.test.ts
git commit -m "feat: integrate inventory deduction into order creation with FOR UPDATE"
```
