# Add `next_action` Column to Orders

**Goal:** Add the `next_action` field from the Nuvemshop API to the orders table, schema, repository, and sync logic.

**Architecture:** New migration → update type interfaces → update schema → map in upsert → include in response.

## Files to modify

| File | Change |
|------|--------|
| `src/database/migrations/20260727100000_add_next_action.ts` | **New** — add `next_action` varchar column to `orders` |
| `src/repositories/order.repository.ts` | Add to `Order` interface, `NuvemshopOrderData`, `upsertOrderFromNuvemshop`, `CreateOrderInput` |
| `src/schemas/order.schema.ts` | Add to `base`, `response`, `listResponse` |
| `src/services/order.service.ts` | Add to `createOrder` upsert mapping |

---

### Task 1: Create migration

**New file:** `src/database/migrations/20260727100000_add_next_action.ts`

```typescript
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.string("next_action", 50).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("next_action");
  });
}
```

- [ ] Create file
- [ ] Run: `npm run db:migrate`
- [ ] `git add src/database/migrations/ && git commit -m "feat: add next_action column to orders"`

---

### Task 2: Update `NuvemshopOrderData` interface + `Order` interface

**Modify:** `src/repositories/order.repository.ts`

Add to `NuvemshopOrderData` (after `contact_email`):
```typescript
  next_action?: string | null;
```

Add to `Order` interface (after `customer_email`):
```typescript
  next_action: string | null;
```

Add to `CreateOrderInput` (if it has order-level fields):
```typescript
  next_action?: string;
```

- [ ] Apply edits
- [ ] `npx tsc --noEmit` — verify
- [ ] `git add src/repositories/order.repository.ts && git commit -m "feat: add next_action to order interfaces"`

---

### Task 3: Add `next_action` to upsert mapping

**Modify:** `src/repositories/order.repository.ts` — inside `upsertOrderFromNuvemshop`

Add to `orderUpsertData` (after `customer_email`):
```typescript
        next_action: data.next_action || null,
```

- [ ] Apply edit
- [ ] `npx tsc --noEmit` — verify
- [ ] `git commit --amend` or `git add -A && git commit -m "feat: map next_action in Nuvemshop order sync"`

---

### Task 4: Add `next_action` to Zod schemas

**Modify:** `src/schemas/order.schema.ts`

Add to `base`:
```typescript
    next_action: z.string().nullable().optional(),
```

Add to `response`:
```typescript
    next_action: z.string().nullable().optional(),
```

Add to `listResponse`:
```typescript
    next_action: z.string().nullable().optional(),
```

- [ ] Apply edits
- [ ] `npx tsc --noEmit` — verify
- [ ] `git add src/schemas/order.schema.ts && git commit -m "feat: add next_action to order Zod schemas"`

---

### Task 5: Run migration + verify

- [ ] Run: `npm run db:migrate`
- [ ] Run: `npx tsc --noEmit`
- [ ] Run: `npm run lint` (expect 0 errors)
- [ ] Verify the full flow: sync order from Nuvemshop → `next_action` is stored and returned in API responses
