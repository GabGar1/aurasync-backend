# AuraSync Backend — Agent Context

E-commerce management system (Nuvemshop-integrated) — orders, inventory, product catalog. Data is built for analytics (margin, cost, stock turnover); accuracy/traceability at transaction time matters more than convenience.

## Stack

- Node + TypeScript (ESM, `"type": "module"`)
- Fastify 5 + `@fastify/jwt` (auth), `@fastify/cors`, `@fastify/swagger`
- Knex (pg) — raw query builder, not an ORM
- Zod for validation
- `ws` for WebSocket broadcasts (`src/lib/websocket.ts`)
- `node:test` + `node:assert` — real integration tests (no mocking)
- `tsx` for running TS directly (dev, tests)

## Quickstart

```bash
docker compose up -d                    # Postgres 15 on :5433
cp .env.example .env || true            # env already exists
npm run db:migrate                      # run migrations
npm run dev                             # tsx watch on :3333
npm test                                # node --test --test-concurrency=1 src/**/*.test.ts
npm run db:make -- <name>               # new migration
npm run db:rollback                     # rollback last batch
npm run db:seed                         # create/reset default SUPER_ADMIN user
```

DB: `postgresql://admin:admin@127.0.0.1:5433/aurasync` (from `DATABASE_URL` env).

## Architecture (strict)

```
Router (src/routers/*.router.ts)  → HTTP, call Service, format response
Service (src/services/*.service.ts)  → business logic, Zod parse, orchestrate Repos
Repository (src/repositories/*.repository.ts)  → only layer touching Knex
```

Router never calls Repository. Service never builds raw Knex queries.

## Conventions

- **Soft delete**: `deleted_at` nullable + `whereNull('deleted_at')` on reads. Never hard delete except methods named `hardDelete`.
- **UUID PKs**: `table.uuid('id').primary().defaultTo(knex.fn.uuid())`.
- **Timestamps**: `table.timestamps(true, true)`.
- **Transactions**: multi-table writes MUST use `db.transaction(async (trx) => {...})`.
- **Validation**: input goes through `XSchema.<action>.parse()` in Service before Repository.
- **Error responses**: `{ error: string }` with HTTP 400/401/403/404/500.
- **Webhook HMAC**: `x-webhook-signature` verified via `nuvemshop.middleware.ts`; raw body enabled only for `/api/webhooks/nuvemshop` via `fastify-raw-body`.
- **Auth**: `fastify.authenticate` (JWT) on protected routes; `requireRole(['ADMIN', 'SUPER_ADMIN'])` for admin-only endpoints.
- **Single util per need**: extract shared logic to `src/lib/` only after a second real use appears.

## Testing (mandatory — TDD)

- Every feature/bugfix starts with a failing test.
- Tests are **real integration tests** — no mocking Knex. Follow `*.service.integration.test.ts` pattern with `cleanupDatabase()` in `before`/`after` (`src/test/setup.ts`).
- `cleanupDatabase()` truncates all tables **except `users`** — seed/admin users survive test runs.
- Tests that create users must clean up only their own data in `after` (by known email/ID), never call `db("users").del()` or truncate the whole table.
- Run: `npm test` (runs serially via `--test-concurrency=1`).
- Hard-delete test artifacts after the suite: `db("table").del()` in `after` (not soft-delete).

## Known quirks / bugs (do not replicate)

- **Price fields inconsistent**: `product.schema.ts` uses `z.int()` (cents), `order.schema.ts` uses `z.number()` (decimal). DB stores as `decimal(10,2)`. If adding new price/cost fields, match DB decimal type (`z.number()`) unless the pattern is deliberately cents.
- **user.schema.ts:49** — `listResponse.id` is typed `z.number()` but DB uses UUID. This is a bug; use `z.string().uuid()` for new schemas.
- **Dead deps**: `express`, `@types/express`, and `cors` in package.json are unused (Fastify is the framework). Do not add Express code.
- **`fastify-type-provider-zod`**: used only in `user.router.ts`. Other routers use plain `FastifyPluginAsync`. Either path is acceptable.
- **Nuvemshop service**: has a top-level side-effect console.log in `nuvemshop.service.ts` (module eval). Do not replicate this pattern.
- **Inventory stock update**: `inventory.repository.ts` directly mutates `product_variants.stock_quantity`. This bypasses the service layer for that specific operation — model new stock logic the same way.

## Git workflow

- Work directly on branches (no PR policy).
- Create a new branch per task.
- Commit finished work — never leave uncommitted changes.
