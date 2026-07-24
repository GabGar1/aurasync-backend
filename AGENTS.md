# AuraSync Backend — Project Context & Standards (Harness)

> Reference document for the AI agent (Superpowers-style harness) working on this repository.
> Based on a real code review of the project (aurasync-backend).

## Purpose of this document

Give the agent context on the project's domain, mandatory code standards, file-creation conventions, the Git workflow (branch/commit), and what defines a task as done. This document does **not** list known bugs — finding and fixing bugs is the agent's own job, not something pre-chewed here.

---

## 1. Project domain

AuraSync Backend is the core of an e-commerce management system (integrated with Nuvemshop) with three central, interrelated modules:

- **Order manager** (`orders` / `order_items`): receives and processes orders, both created internally and synced via Nuvemshop webhooks.
- **Inventory/stock manager** (`inventory_transactions`): records every stock movement (sale, restock, adjustment) and keeps `product_variants.stock_quantity` consistent with the transaction history.
- **Catalog/inventory data** (`products` / `product_variants`): source of truth for products, variants, prices, costs, and fees.

These three modules exist to feed the system's ultimate goal: **generating data intelligence for real business decision-making** (margin per product, real cost vs. sale price, stock turnover, sales performance, etc.). Any new data modeling or feature must consider that the data generated here will later be consumed by analytics/reporting — meaning data accuracy and traceability (cost, fee, price at the exact moment of the transaction) matter more than implementation convenience.

---

## 2. Stack

- Runtime: Node.js + TypeScript (ESM, `"type": "module"`)
- HTTP framework: Fastify 5 (+ `fastify-type-provider-zod`)
- ORM / query builder: Knex (client `pg`)
- Validation: Zod
- Auth: `@fastify/jwt`
- Realtime: `ws` (native WebSocket, managed in `src/lib/websocket.ts`)
- External integration: Nuvemshop (Tiendanube) API
- Tests: `node:test` + `node:assert`, real **integration tests** (not mocked)

---

## 3. Architecture (MUST FOLLOW)

Strict layers, no skipping steps:

```
Router (src/routers/*.router.ts)
  → handles HTTP, validates payload, calls Service, formats response
Service (src/services/*.service.ts)
  → business logic, Zod validation (Schema.x.parse()), orchestrates Repository(ies)
Repository (src/repositories/*.repository.ts)
  → the only layer that talks to Knex/the database
```

Rule: Router **never** calls Repository directly. Service **never** builds raw Knex queries directly.

---

## 4. Mandatory code principles

- **SOLID** whenever applicable:
  - **SRP** — each Service/Repository owns a single domain responsibility; don't mix order business logic inside the inventory service, for example.
  - **DIP** — higher layers depend on types/interfaces (contracts), not on the implementation details of lower layers.
  - **OCP/LSP/ISP** — prefer composition and small, cohesive interfaces over rigid inheritance or classes that do everything.
- **Util rule**: any logic/function used in more than one place (even across different layers or modules) must be extracted into a shared utility function (`src/lib/` or `src/utils/`), never duplicated. Before writing a new function, check whether an equivalent one already exists in the project.
- No premature abstraction: a function only becomes a util once the second real use actually appears — don't pre-build utils "just in case."

---

## 5. Established conventions (always follow)

- **Soft delete**: every domain entity uses `deleted_at` (nullable) + `whereNull('deleted_at')` on every read. Never hard delete, except in methods explicitly named `hardDelete`.
- **IDs**: UUID (`table.uuid('id').primary().defaultTo(knex.fn.uuid())`), never serial/int.
- **Timestamps**: `table.timestamps(true, true)` (automatic created_at/updated_at).
- **Transactions**: any operation that writes to more than one table (e.g., order + items, stock + transaction) MUST use `db.transaction(async (trx) => {...})`.
- **Validation**: all user input goes through `XSchema.<action>.parse()` in the Service before touching the Repository.
- **API error pattern**: `{ error: string }` with the appropriate HTTP status (400/401/403/404).
- **External webhooks**: always validate the HMAC signature using the raw body before processing (reference: `nuvemshop.middleware.ts`).

---

## 6. TDD (mandatory)

- Every new feature or bug fix starts with a failing test, then the minimal implementation to make it pass, then refactor.
- Service tests are **real integration tests** (test database), following the existing pattern in `*.service.integration.test.ts` (`cleanupDatabase()` in `before`/`after`). Do not mock Knex.
- No task is considered done without a test covering the implemented or fixed case.

---

## 7. Git workflow: branch & commit

- There is no PR policy — work happens directly on branches.
- When starting a task, create a new branch dedicated to it.
- When finishing a task, always commit the work on that branch — never leave changes uncommitted.

---

## 8. Definition of Done

A task is only considered complete when it is:

1. **Tested** — covered by test(s) following TDD, relevant cases validated.
2. **Reviewed** — code reviewed before being marked as finished.
3. **Bug-free** — no known bugs introduced or left behind in what was touched.
