# Bugfixes: User Search, Pool Config, Inventory Deduction & Concurrency

Fix four bugs in the order/inventory/user subsystems.

## 1. User Search Column Mismatch

**`src/repositories/user.repository.ts:116`** — `builder.where('name', 'ilike', ...)` references a column `name` that does not exist in the `users` table. The table has `first_name` and `last_name`.

**Fix:** Search across `first_name` and `last_name` instead:

```
builder.where('first_name', 'ilike', `%${filters.search}%`)
  .orWhere('last_name', 'ilike', `%${filters.search}%`)
  .orWhere('email', 'ilike', `%${filters.search}%`);
```

**Test:** Add a search filter test to `user.service.integration.test.ts`.

## 2. Database Connection Pool Idle Timeout

**`knexfile.ts:14`** — `idleTimeoutMillis: 100` destroys idle connections after 100ms, defeating pooling.

**Fix:** `idleTimeoutMillis: 100` → `30000`, `min: 0` → `2`.

## 3. Inventory Deduction on Order Creation

**`src/repositories/order.repository.ts:82-107`** — `create()` inserts orders and items but never modifies `product_variants.stock_quantity`.

**Fix:** Within the existing transaction in `create()`, add stock deduction for each order item:

```
for each item:
  SELECT ... FOR UPDATE variant
  check stock >= quantity
  UPDATE stock_quantity = stock_quantity - quantity
  INSERT inventory_transaction (variant_id, order_id, quantity_changed = -quantity, type = 'SALE')
```

## 4. Race Conditions in Inventory Updates

**`src/repositories/inventory.repository.ts:26-28`** — plain `SELECT` without row lock.

**Fix:** Add `.forUpdate()` to the variant SELECT in `createTransaction()`.

**Additional safety net:** New migration adding `CHECK (stock_quantity >= 0)` on `product_variants`.

## Files Changed

| File | Change |
|---|---|
| `src/repositories/user.repository.ts:116` | `'name'` → `first_name`/`last_name` search |
| `knexfile.ts:14` | `idleTimeoutMillis: 100` → `30000`, `min: 0` → `2` |
| `src/repositories/order.repository.ts` | Add stock deduction + FOR UPDATE in `create()` |
| `src/repositories/inventory.repository.ts:26` | Add `.forUpdate()` to SELECT |
| `src/database/migrations/20260724220000_add_stock_check.ts` | New migration for CHECK constraint |
| `src/services/user.service.integration.test.ts` | Add search filter test |
| `src/services/order.service.integration.test.ts` | Tests for stock deduction + concurrency |

## Testing

- User search: verify search by first_name and last_name returns correct results
- Order creation: verify stock_quantity decreases, inventory_transaction created
- Order creation with insufficient stock: verify error thrown, no order created (rollback)
- Inventory transaction with insufficient stock: verify error thrown
- Concurrency: verify FOR UPDATE prevents double-deduction
