# Motor de Custos v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expandir o motor de custos existente para suportar aquisição por produto, subgrupos de produtos, embalagem com capacidade/consolidação, taxa de crédito por parcelas, custos mensais com fechamento mensal, custo de feira e frete.

**Architecture:** Evoluir o sistema atual (não reescrever). Novas entidades (`product_subgroups`, `subgroup_cost_components`, `credit_fee_tiers`, `order_monthly_allocations`), extensão do `cost-engine.ts` (embalagem/taxa de crédito/feira/aquisição) e um novo engine de fechamento mensal (`monthly-cost-engine.ts` + `cost-closing`). Snapshot por venda permanece congelado; custos mensais ficam em camada separada.

**Tech Stack:** Node + TypeScript (ESM), Fastify 5 + `fastify-type-provider-zod`, Knex (pg), Zod, `node:test` + `node:assert` (integração real, sem mock), `tsx`.

## Global Constraints

- Leia `docs/superpowers/specs/2026-08-14-cost-engine-v2-design.md` (spec) e `AGENTS.md` antes de começar.
- Arquitetura estrita: Router → Service → Repository (Repository é a única camada que toca Knex). Service não monta query crua (exceto onde já existia, ex. `simulateCosts`).
- UUID PKs: `table.uuid('id').primary().defaultTo(knex.fn.uuid())`. Timestamps: `table.timestamps(true, true)`.
- Soft delete: `deleted_at` + `whereNull('deleted_at')` nas leituras. Hard delete só em métodos chamados `hardDelete*`.
- Multi-table writes: `db.transaction(async (trx) => {...})`.
- Validação: `XSchema.<action>.parse()` no Service antes do Repository.
- Colunas `decimal` do Postgres voltam como **string** via `pg` — sempre `Number(...)` antes de aritmética.
- Erros: `{ error: string }` com HTTP 400/401/403/404/500. Rotas protegidas: `onRequest: [fastify.authenticate]` + `preHandler: [requireRole(['ADMIN','SUPER_ADMIN'])]`; mutações também com `csrfProtection()`.
- Preços novos usam `z.number()` (decimal), NUNCA `z.int()` (centavos).
- Testes: TDD. Escrever teste que falha → rodar → implementar → rodar → commit. `npm test` roda em banco isolado `aurasync_test` (nunca toca dev). `cleanupDatabase()` em `before`/`after` (preserva `users`).
- Verificar a cada task: `npm run lint` e `npx tsc --noEmit`.
- Commitar ao final de cada task. Mensagens no estilo do repo (ex.: `feat: ...`).

---

## File Structure

**Criar:**
- `src/database/migrations/20260814090000_cost_engine_v2.ts`
- `src/schemas/product-subgroup.schema.ts`
- `src/repositories/product-subgroup.repository.ts`
- `src/services/product-subgroup.service.ts`
- `src/routers/product-subgroup.router.ts`
- `src/services/product-subgroup.service.integration.test.ts`
- `src/schemas/credit-fee.schema.ts`
- `src/repositories/credit-fee.repository.ts`
- `src/services/credit-fee.service.ts`
- `src/routers/credit-fee.router.ts`
- `src/services/credit-fee.service.integration.test.ts`
- `src/lib/monthly-cost-engine.ts`
- `src/lib/monthly-cost-engine.test.ts`
- `src/repositories/cost-closing.repository.ts`
- `src/services/cost-closing.service.ts`
- `src/routers/cost-closing.router.ts`
- `src/services/cost-closing.service.integration.test.ts`

**Modificar:**
- `src/test/setup.ts` (cleanup: novas tabelas)
- `src/schemas/cost.schema.ts` (novos `type`, campos, `category`; schemas associate-subgroup/associate-batch)
- `src/repositories/cost.repository.ts` (associação por subgrupo, batch, `getComponentsBySubgroupIds`)
- `src/services/cost.service.ts` (associateSubgroup, associateBatch, getAssociationsBySubgroup, `simulateCosts`)
- `src/routers/cost.router.ts` (rotas novas)
- `src/lib/cost-engine.ts` (aquisição, embalagem, taxa de crédito, feira)
- `src/lib/cost-engine.test.ts` (atualizar teste MONTHLY + novos testes)
- `src/repositories/order.repository.ts` (subgroup_id, componentes de subgrupo, credit fee, is_fair, monthly_allocations)
- `src/schemas/order.schema.ts` (response: is_fair, monthly_cost_total, total_cost_with_monthly, monthly_allocations)
- `src/lib/order-status.ts` (enrichOrder: campos novos)
- `src/schemas/external-sale.schema.ts` (`is_fair`)
- `src/repositories/external-sale.repository.ts` (persistir `is_fair`)
- `src/services/external-sale.service.ts` (subgroup components, credit fee, is_fair)
- `src/server.ts` (registrar 3 routers novos)

---

## Task 1: Migração do modelo de dados

**Files:**
- Create: `src/database/migrations/20260814090000_cost_engine_v2.ts`
- Modify: `src/test/setup.ts:3-13`

**Interfaces:**
- Produces: tabelas `product_subgroups`, `subgroup_cost_components`, `credit_fee_tiers`, `order_monthly_allocations`; colunas `products.subgroup_id`, `orders.is_fair`, `orders.monthly_cost_total`, e novos campos em `cost_components` (`max_products_per_package`, `consolidates`, `allocation_basis`, `period_start`, `period_end`, `applies_to_fair_only`). Seed de `credit_fee_tiers`.

- [ ] **Step 1: Criar a migration**

`src/database/migrations/20260814090000_cost_engine_v2.ts`:

```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("product_subgroups", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.string("name").notNullable();
    table.string("description").nullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("subgroup_cost_components", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("subgroup_id").references("id").inTable("product_subgroups").onDelete("CASCADE").notNullable().index();
    table.uuid("cost_component_id").references("id").inTable("cost_components").onDelete("CASCADE").notNullable();
    table.integer("quantity").notNullable().defaultTo(1);
    table.timestamps(true, true);
    table.unique(["subgroup_id", "cost_component_id"]);
  });

  await knex.schema.createTable("credit_fee_tiers", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.integer("installments").notNullable().unique();
    table.decimal("percent", 5, 2).notNullable().defaultTo(0);
    table.decimal("fixed_fee", 10, 2).notNullable().defaultTo(0);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("order_monthly_allocations", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("order_id").references("id").inTable("orders").onDelete("CASCADE").notNullable().index();
    table.uuid("cost_component_id").references("id").inTable("cost_components").onDelete("CASCADE").notNullable();
    table.decimal("amount", 10, 2).notNullable().defaultTo(0);
    table.date("period_start").notNullable();
    table.date("period_end").notNullable();
    table.timestamps(true, true);
    table.unique(["order_id", "cost_component_id", "period_start", "period_end"]);
  });

  await knex.schema.alterTable("products", (table) => {
    table.uuid("subgroup_id").references("id").inTable("product_subgroups").onDelete("SET NULL").nullable().index();
  });

  await knex.schema.alterTable("orders", (table) => {
    table.boolean("is_fair").notNullable().defaultTo(false);
    table.decimal("monthly_cost_total", 10, 2).notNullable().defaultTo(0);
  });

  await knex.schema.alterTable("cost_components", (table) => {
    table.integer("max_products_per_package").nullable();
    table.boolean("consolidates").notNullable().defaultTo(false);
    table.string("allocation_basis").nullable();
    table.date("period_start").nullable();
    table.date("period_end").nullable();
    table.boolean("applies_to_fair_only").notNullable().defaultTo(false);
  });

  await knex("credit_fee_tiers").insert([
    { installments: 1, percent: 5.19, fixed_fee: 0.35 },
    { installments: 2, percent: 6.38, fixed_fee: 0 },
    { installments: 3, percent: 7.76, fixed_fee: 0 },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex("credit_fee_tiers").del();
  await knex.schema.alterTable("cost_components", (table) => {
    table.dropColumn("max_products_per_package");
    table.dropColumn("consolidates");
    table.dropColumn("allocation_basis");
    table.dropColumn("period_start");
    table.dropColumn("period_end");
    table.dropColumn("applies_to_fair_only");
  });
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("is_fair");
    table.dropColumn("monthly_cost_total");
  });
  await knex.schema.alterTable("products", (table) => {
    table.dropColumn("subgroup_id");
  });
  await knex.schema.dropTableIfExists("order_monthly_allocations");
  await knex.schema.dropTableIfExists("credit_fee_tiers");
  await knex.schema.dropTableIfExists("subgroup_cost_components");
  await knex.schema.dropTableIfExists("product_subgroups");
}
```

- [ ] **Step 2: Rodar a migration**

Run: `npm run db:migrate`
Expected: saída do knex listando a migration aplicada, sem erro.

- [ ] **Step 3: Atualizar o cleanup de testes**

Em `src/test/setup.ts`, trocar o array `tables` (linhas 4-13) por:

```ts
  const tables = [
    'order_monthly_allocations',
    'inventory_transactions',
    'order_items',
    'orders',
    'product_variants',
    'products',
    'subgroup_cost_components',
    'product_cost_components',
    'cost_components',
    'credit_fee_tiers',
    'product_subgroups',
    'customers'
  ];
```

- [ ] **Step 4: Rodar a suíte para confirmar que nada quebrou**

Run: `npm test`
Expected: suíte verde.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/20260814090000_cost_engine_v2.ts src/test/setup.ts
git commit -m "feat: add cost engine v2 schema (subgroups, credit fee tiers, monthly allocations)"
```

---

## Task 2: Subgrupos de produto (CRUD + atribuir produtos)

**Files:**
- Create: `src/schemas/product-subgroup.schema.ts`
- Create: `src/repositories/product-subgroup.repository.ts`
- Create: `src/services/product-subgroup.service.ts`
- Create: `src/routers/product-subgroup.router.ts`
- Create: `src/services/product-subgroup.service.integration.test.ts`
- Modify: `src/server.ts` (import + register)

**Interfaces:**
- Produces:
  - `ProductSubgroupSchema` (objeto com `base`, `create`, `update`, `response`, `listResponse`).
  - `productSubgroupService.listSubgroups(filter?)`, `createSubgroup(data)`, `updateSubgroup(id, data)`, `deleteSubgroup(id)`, `assignProductsToSubgroup(subgroupId, productIds)`.
  - `productSubgroupRepository.findById(id)`, `list(filter)`, `create(data)`, `update(id, data)`, `softDelete(id)`, `assignProducts(subgroupId, productIds)`.
- Consumes: `products` (tabela), `products.subgroup_id` (Task 1).

- [ ] **Step 1: Escrever o teste que falha**

`src/services/product-subgroup.service.integration.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { productSubgroupService } from "./product-subgroup.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("ProductSubgroupService Integration Tests", () => {
  let subgroupId: string;

  before(async () => { await cleanupDatabase(); });
  after(async () => { await cleanupDatabase(); await closeDatabase(); });

  it("creates a subgroup", async () => {
    const sg = await productSubgroupService.createSubgroup({ name: "Anéis", description: "Anéis pequenos" });
    subgroupId = sg.id;
    assert.ok(sg.id);
    assert.strictEqual(sg.name, "Anéis");
    assert.strictEqual(sg.is_active, true);
  });

  it("lists subgroups", async () => {
    const list = await productSubgroupService.listSubgroups();
    assert.ok(list.some((s: any) => s.id === subgroupId));
  });

  it("assigns products to a subgroup in batch", async () => {
    const [p1] = await db('products').insert({ slug: 'sg-p1', name: 'P1' }).returning('*');
    const [p2] = await db('products').insert({ slug: 'sg-p2', name: 'P2' }).returning('*');
    await productSubgroupService.assignProductsToSubgroup(subgroupId, [p1.id, p2.id]);
    const r1 = await db('products').where({ id: p1.id }).first();
    const r2 = await db('products').where({ id: p2.id }).first();
    assert.strictEqual(r1.subgroup_id, subgroupId);
    assert.strictEqual(r2.subgroup_id, subgroupId);
  });

  it("updates a subgroup", async () => {
    const updated = await productSubgroupService.updateSubgroup(subgroupId, { name: "Anéis e Alianças" });
    assert.strictEqual(updated!.name, "Anéis e Alianças");
  });

  it("soft-deletes a subgroup", async () => {
    const deleted = await productSubgroupService.deleteSubgroup(subgroupId);
    assert.strictEqual(deleted, true);
    const list = await productSubgroupService.listSubgroups();
    assert.ok(!list.some((s: any) => s.id === subgroupId));
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx tsx --test src/services/product-subgroup.service.integration.test.ts`
Expected: FAIL — `Cannot find module './product-subgroup.service.js'`.

- [ ] **Step 3: Criar o schema**

`src/schemas/product-subgroup.schema.ts`:

```ts
import { z } from "zod";

export const ProductSubgroupSchema = {
  base: z.object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    is_active: z.boolean().default(true),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
  }),

  create: z.object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().max(500).optional(),
    is_active: z.boolean().optional(),
  }),

  update: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    is_active: z.boolean().optional(),
  }),

  assignProducts: z.object({
    product_ids: z.array(z.uuid()).min(1, "product_ids is required"),
  }),

  response: z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable().optional(),
    is_active: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
  }),
};

export type ProductSubgroupCreate = z.input<typeof ProductSubgroupSchema.create>;
export type ProductSubgroupUpdate = z.input<typeof ProductSubgroupSchema.update>;
```

- [ ] **Step 4: Criar o repository**

`src/repositories/product-subgroup.repository.ts`:

```ts
import { db } from '../lib/db.js';

export class ProductSubgroupRepository {
  private table = 'product_subgroups';

  async findById(id: string) {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  async list(filter: { is_active?: boolean; search?: string } = {}) {
    let q = db(this.table).whereNull('deleted_at').orderBy('name', 'asc');
    if (filter.is_active !== undefined) q = q.where('is_active', filter.is_active);
    if (filter.search) q = q.where('name', 'ilike', `%${filter.search}%`);
    return q;
  }

  async create(data: { name: string; description?: string | null; is_active: boolean }) {
    const [row] = await db(this.table).insert(data).returning('*');
    return row;
  }

  async update(id: string, data: { name?: string; description?: string | null; is_active?: boolean }) {
    const [row] = await db(this.table)
      .where({ id }).whereNull('deleted_at')
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return row || null;
  }

  async softDelete(id: string) {
    const result = await db(this.table)
      .where({ id }).whereNull('deleted_at')
      .update({ deleted_at: new Date(), is_active: false, updated_at: new Date() });
    return result > 0;
  }

  async assignProducts(subgroupId: string, productIds: string[]) {
    const result = await db('products')
      .whereIn('id', productIds)
      .whereNull('deleted_at')
      .update({ subgroup_id: subgroupId, updated_at: new Date() });
    return result;
  }
}

export const productSubgroupRepository = new ProductSubgroupRepository();
```

- [ ] **Step 5: Criar o service**

`src/services/product-subgroup.service.ts`:

```ts
import { productSubgroupRepository } from '../repositories/product-subgroup.repository.js';
import { ProductSubgroupSchema, type ProductSubgroupCreate, type ProductSubgroupUpdate } from '../schemas/product-subgroup.schema.js';

export class ProductSubgroupService {
  async listSubgroups(filter: { is_active?: boolean; search?: string } = {}) {
    return productSubgroupRepository.list(filter);
  }

  async createSubgroup(data: ProductSubgroupCreate) {
    const v = ProductSubgroupSchema.create.parse(data);
    return productSubgroupRepository.create({
      name: v.name,
      description: v.description ?? null,
      is_active: v.is_active ?? true,
    });
  }

  async updateSubgroup(id: string, data: ProductSubgroupUpdate) {
    const v = ProductSubgroupSchema.update.parse(data);
    const existing = await productSubgroupRepository.findById(id);
    if (!existing) throw new Error('Subgroup not found');
    return productSubgroupRepository.update(id, v);
  }

  async deleteSubgroup(id: string) {
    const existing = await productSubgroupRepository.findById(id);
    if (!existing) throw new Error('Subgroup not found');
    return productSubgroupRepository.softDelete(id);
  }

  async assignProductsToSubgroup(subgroupId: string, productIds: string[]) {
    const v = ProductSubgroupSchema.assignProducts.parse({ product_ids: productIds });
    const existing = await productSubgroupRepository.findById(subgroupId);
    if (!existing) throw new Error('Subgroup not found');
    const count = await productSubgroupRepository.assignProducts(subgroupId, v.product_ids);
    return { assigned: count };
  }
}

export const productSubgroupService = new ProductSubgroupService();
```

- [ ] **Step 6: Criar o router**

`src/routers/product-subgroup.router.ts`:

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { productSubgroupService } from '../services/product-subgroup.service.js';
import { ProductSubgroupSchema } from '../schemas/product-subgroup.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const productSubgroupRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { querystring: z.object({ is_active: z.string().optional(), search: z.string().optional() }) },
  }, async (request, reply) => {
    try {
      const { is_active, search } = request.query;
      const filters: { is_active?: boolean; search?: string } = {};
      if (is_active !== undefined) filters.is_active = is_active === 'true';
      if (search !== undefined) filters.search = search;
      return reply.send(await productSubgroupService.listSubgroups(filters));
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: ProductSubgroupSchema.create },
  }, async (request, reply) => {
    try {
      return reply.code(201).send(await productSubgroupService.createSubgroup(request.body));
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: ProductSubgroupSchema.update },
  }, async (request, reply) => {
    try {
      const sg = await productSubgroupService.updateSubgroup(request.params.id, request.body);
      if (!sg) return reply.code(404).send({ error: 'Subgroup not found' });
      return reply.send(sg);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/:id/products', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: ProductSubgroupSchema.assignProducts },
  }, async (request, reply) => {
    try {
      return reply.send(await productSubgroupService.assignProductsToSubgroup(request.params.id, request.body.product_ids));
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const deleted = await productSubgroupService.deleteSubgroup(request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Subgroup not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
```

- [ ] **Step 7: Registrar no server**

Em `src/server.ts`, adicionar import (junto aos demais, ~linha 16):

```ts
import { productSubgroupRoutes } from './routers/product-subgroup.router.js';
```

E registrar (junto aos demais `app.register`, ~linha 102):

```ts
app.register(productSubgroupRoutes, { prefix: '/api/product-subgroups' });
```

- [ ] **Step 8: Rodar o teste**

Run: `npx tsx --test src/services/product-subgroup.service.integration.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 9: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add src/schemas/product-subgroup.schema.ts src/repositories/product-subgroup.repository.ts src/services/product-subgroup.service.ts src/routers/product-subgroup.router.ts src/services/product-subgroup.service.integration.test.ts src/server.ts
git commit -m "feat: add product subgroups CRUD and batch product assignment"
```

---

## Task 3: Estender o catálogo de componentes de custo (schema + associação por subgrupo e em lote)

**Files:**
- Modify: `src/schemas/cost.schema.ts`
- Modify: `src/repositories/cost.repository.ts`
- Modify: `src/services/cost.service.ts`
- Modify: `src/routers/cost.router.ts`

**Interfaces:**
- Consumes: `productSubgroupRepository.findById` (Task 2).
- Produces (novos):
  - Enums: `CostComponentTypeEnum` inclui `PACKAGING | MONTHLY_FIXED | MONTHLY_PERCENT`; `CostComponentCategoryEnum` inclui `ACQUISITION | CREDIT_FEE`; `AllocationBasisEnum = ["PER_ORDER","PER_PRODUCT"]`.
  - Campos novos no `CostComponentBaseSchema`: `max_products_per_package`, `consolidates`, `allocation_basis`, `period_start`/`period_end`, `applies_to_fair_only`.
  - `costService.associateSubgroup({subgroup_id, cost_component_id, quantity})`, `costService.associateBatch({cost_component_id, product_ids?, subgroup_ids?, quantity})`, `costService.getAssociationsBySubgroup(subgroupId)`, `costService.removeSubgroupAssociation(id)`.
  - `costRepository.getComponentsBySubgroupIds(subgroupIds, trx?)`.

- [ ] **Step 1: Atualizar `src/schemas/cost.schema.ts`**

Substituir o bloco de enums (linhas 3-7) por:

```ts
export const CostComponentTypeEnum = z.enum([
  "FIXED", "PERCENT", "PER_ORDER", "PACKAGING", "MONTHLY_FIXED", "MONTHLY_PERCENT",
]);
export const CostComponentCategoryEnum = z.enum([
  "PACKAGING", "TAX", "FEE", "SHIPPING", "OPERATIONAL", "MARKETING", "OTHER", "ACQUISITION", "CREDIT_FEE",
]);
export const CalculationBaseEnum = z.enum(["PRICE", "COST"]);
export const AllocationBasisEnum = z.enum(["PER_ORDER", "PER_PRODUCT"]);
```

Substituir `CostComponentBaseSchema` (linhas 9-20) por:

```ts
const CostComponentBaseSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  type: CostComponentTypeEnum,
  category: CostComponentCategoryEnum.default("OTHER"),
  value: z.number().min(0, "Value cannot be negative"),
  calculation_base: CalculationBaseEnum.default("PRICE"),
  is_active: z.boolean().default(true),
  max_products_per_package: z.number().int().positive().nullable().optional(),
  consolidates: z.boolean().default(false),
  allocation_basis: AllocationBasisEnum.nullable().optional(),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  applies_to_fair_only: z.boolean().default(false),
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
});
```

Substituir `create` (linhas 33-45) por:

```ts
  create: z.object({
    name: z.string().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
    description: z.string().max(500).optional(),
    type: CostComponentTypeEnum,
    category: CostComponentCategoryEnum.optional(),
    value: z.number().min(0, "Value cannot be negative"),
    calculation_base: CalculationBaseEnum.optional(),
    is_active: z.boolean().optional(),
    max_products_per_package: z.number().int().positive().optional(),
    consolidates: z.boolean().optional(),
    allocation_basis: AllocationBasisEnum.optional(),
    period_start: z.string().optional(),
    period_end: z.string().optional(),
    applies_to_fair_only: z.boolean().optional(),
  }).superRefine((data, ctx) => {
    if (data.type === "PERCENT" && data.calculation_base === undefined) {
      ctx.addIssue({ code: "custom", path: ["calculation_base"], message: "calculation_base is required for PERCENT components" });
    }
    if (data.type === "MONTHLY_FIXED" && data.allocation_basis === undefined) {
      ctx.addIssue({ code: "custom", path: ["allocation_basis"], message: "allocation_basis is required for MONTHLY_FIXED components" });
    }
    if (data.type === "PACKAGING" && data.max_products_per_package === undefined) {
      ctx.addIssue({ code: "custom", path: ["max_products_per_package"], message: "max_products_per_package is required for PACKAGING components" });
    }
  }),
```

Substituir `update` (linhas 47-55) por:

```ts
  update: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    type: CostComponentTypeEnum.optional(),
    category: CostComponentCategoryEnum.optional(),
    value: z.number().min(0).optional(),
    calculation_base: CalculationBaseEnum.optional(),
    is_active: z.boolean().optional(),
    max_products_per_package: z.number().int().positive().nullable().optional(),
    consolidates: z.boolean().optional(),
    allocation_basis: AllocationBasisEnum.nullable().optional(),
    period_start: z.string().nullable().optional(),
    period_end: z.string().nullable().optional(),
    applies_to_fair_only: z.boolean().optional(),
  }),
```

Após o schema `associate` (linhas 57-61), adicionar:

```ts
  associateSubgroup: z.object({
    subgroup_id: z.uuid("Invalid subgroup ID"),
    cost_component_id: z.uuid("Invalid component ID"),
    quantity: z.number().int().positive().default(1),
  }),

  associateBatch: z.object({
    cost_component_id: z.uuid("Invalid component ID"),
    product_ids: z.array(z.uuid()).optional(),
    subgroup_ids: z.array(z.uuid()).optional(),
    quantity: z.number().int().positive().default(1),
  }).superRefine((data, ctx) => {
    const hasProducts = (data.product_ids?.length ?? 0) > 0;
    const hasSubgroups = (data.subgroup_ids?.length ?? 0) > 0;
    if (!hasProducts && !hasSubgroups) {
      ctx.addIssue({ code: "custom", path: ["product_ids"], message: "product_ids or subgroup_ids is required" });
    }
  }),
```

Adicionar exports de tipo (após a linha 105):

```ts
export type CostAssociateSubgroup = z.infer<typeof CostSchema.associateSubgroup>;
export type CostAssociateBatch = z.infer<typeof CostSchema.associateBatch>;
```

- [ ] **Step 2: Atualizar `src/repositories/cost.repository.ts`**

Alterar a interface `ComponentWithQuantity` (linhas 5-13) para incluir os campos novos:

```ts
export interface ComponentWithQuantity {
  id: string;
  name: string;
  type: string;
  category: string;
  value: number;
  calculation_base: string;
  quantity: number;
  max_products_per_package?: number | null;
  consolidates?: boolean;
  applies_to_fair_only?: boolean;
}
```

Adicionar o import de tipo (linha 3):

```ts
import type { CostComponent, CostComponentCreate, CostComponentUpdate, CostAssociationCreate, CostAssociateSubgroup } from '../schemas/cost.schema.js';
```

Atualizar `getComponentsByProductIds` para selecionar os 3 campos novos. Localize o `.select(...)` desse método (~linhas 114-123) e adicione as 3 colunas:

```ts
        `${this.table}.id`,
        `${this.table}.name`,
        `${this.table}.type`,
        `${this.table}.category`,
        `${this.table}.value`,
        `${this.table}.calculation_base`,
        `${this.table}.max_products_per_package`,
        `${this.table}.consolidates`,
        `${this.table}.applies_to_fair_only`,
```

Adicionar métodos ao final da classe (após `getComponentsByProductIds`, ~linha 124):

```ts
  async associateSubgroup(data: CostAssociateSubgroup): Promise<{ id: string; subgroup_id: string; cost_component_id: string; quantity: number }> {
    const [row] = await db('subgroup_cost_components')
      .insert(data)
      .onConflict(['subgroup_id', 'cost_component_id'])
      .merge({ quantity: data.quantity })
      .returning('*');
    return row;
  }

  async hardDeleteSubgroupAssociation(id: string): Promise<boolean> {
    const result = await db('subgroup_cost_components').where({ id }).del();
    return result > 0;
  }

  async listAssociationsBySubgroup(subgroupId: string) {
    const rows = await db('subgroup_cost_components')
      .where('subgroup_cost_components.subgroup_id', subgroupId)
      .join('cost_components', 'cost_components.id', 'subgroup_cost_components.cost_component_id')
      .whereNull('cost_components.deleted_at')
      .select(
        'subgroup_cost_components.id',
        'subgroup_cost_components.subgroup_id',
        'subgroup_cost_components.cost_component_id',
        'subgroup_cost_components.quantity',
        'cost_components.id as component_id',
        'cost_components.name',
        'cost_components.description',
        'cost_components.type',
        'cost_components.category',
        'cost_components.value',
        'cost_components.calculation_base',
        'cost_components.is_active',
        'cost_components.max_products_per_package',
        'cost_components.consolidates',
        'cost_components.allocation_basis',
        'cost_components.period_start',
        'cost_components.period_end',
        'cost_components.applies_to_fair_only',
        'cost_components.created_at',
        'cost_components.updated_at',
      );
    return rows.map((r) => ({
      id: r.id,
      subgroup_id: r.subgroup_id,
      cost_component_id: r.cost_component_id,
      quantity: r.quantity,
      component: {
        id: r.component_id,
        name: r.name,
        description: r.description,
        type: r.type,
        category: r.category,
        value: r.value,
        calculation_base: r.calculation_base,
        is_active: r.is_active,
        max_products_per_package: r.max_products_per_package,
        consolidates: r.consolidates,
        allocation_basis: r.allocation_basis,
        period_start: r.period_start,
        period_end: r.period_end,
        applies_to_fair_only: r.applies_to_fair_only,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    }));
  }

  async getComponentsBySubgroupIds(subgroupIds: string[], trx?: Knex.Transaction) {
    if (subgroupIds.length === 0) return [];
    const query = (trx ?? db);
    return query('subgroup_cost_components')
      .whereIn('subgroup_cost_components.subgroup_id', subgroupIds)
      .join('cost_components', 'cost_components.id', 'subgroup_cost_components.cost_component_id')
      .whereNull('cost_components.deleted_at')
      .select(
        'subgroup_cost_components.subgroup_id',
        'subgroup_cost_components.quantity',
        'cost_components.id',
        'cost_components.name',
        'cost_components.type',
        'cost_components.category',
        'cost_components.value',
        'cost_components.calculation_base',
        'cost_components.max_products_per_package',
        'cost_components.consolidates',
        'cost_components.applies_to_fair_only',
      );
  }
```

- [ ] **Step 3: Atualizar `src/services/cost.service.ts`**

Adicionar import (linhas 2-3):

```ts
import { productSubgroupRepository } from '../repositories/product-subgroup.repository.js';
import { CostSchema, type CostComponentCreate, type CostComponentUpdate, type CostAssociationCreate, type CostAssociateSubgroup, type CostAssociateBatch, type CostSimulateInput } from '../schemas/cost.schema.js';
```

No `createComponent` (linhas 12-24), trocar o `payload` por:

```ts
    const payload = {
      name: validated.name,
      type: validated.type,
      category: validated.category ?? 'OTHER',
      value: validated.value,
      calculation_base: validated.calculation_base ?? 'PRICE',
      is_active: validated.is_active ?? true,
      max_products_per_package: validated.max_products_per_package ?? null,
      consolidates: validated.consolidates ?? false,
      allocation_basis: validated.allocation_basis ?? null,
      period_start: validated.period_start ?? null,
      period_end: validated.period_end ?? null,
      applies_to_fair_only: validated.applies_to_fair_only ?? false,
      ...(validated.description !== undefined && { description: validated.description }),
    };
```

Adicionar métodos ao final da classe (após `simulateCosts`):

```ts
  async associateSubgroup(data: CostAssociateSubgroup) {
    const validated = CostSchema.associateSubgroup.parse(data);
    const subgroup = await productSubgroupRepository.findById(validated.subgroup_id);
    if (!subgroup) throw new Error('Subgroup not found');
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new Error('Cost component not found');
    return costRepository.associateSubgroup(validated);
  }

  async removeSubgroupAssociation(id: string) {
    return costRepository.hardDeleteSubgroupAssociation(id);
  }

  async getAssociationsBySubgroup(subgroupId: string) {
    const subgroup = await productSubgroupRepository.findById(subgroupId);
    if (!subgroup) throw new Error('Subgroup not found');
    return costRepository.listAssociationsBySubgroup(subgroupId);
  }

  async associateBatch(data: CostAssociateBatch) {
    const validated = CostSchema.associateBatch.parse(data);
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new Error('Cost component not found');

    const results: { product: Array<{ product_id: string }>; subgroup: Array<{ subgroup_id: string }> } = { product: [], subgroup: [] };

    for (const productId of validated.product_ids ?? []) {
      const product = await productRepository.findById(productId);
      if (!product) throw new Error(`Product ${productId} not found`);
      const assoc = await costRepository.associateComponent({ product_id: productId, cost_component_id: validated.cost_component_id, quantity: validated.quantity });
      results.product.push({ product_id: assoc.product_id });
    }
    for (const subgroupId of validated.subgroup_ids ?? []) {
      const subgroup = await productSubgroupRepository.findById(subgroupId);
      if (!subgroup) throw new Error(`Subgroup ${subgroupId} not found`);
      const assoc = await costRepository.associateSubgroup({ subgroup_id: subgroupId, cost_component_id: validated.cost_component_id, quantity: validated.quantity });
      results.subgroup.push({ subgroup_id: assoc.subgroup_id });
    }
    return results;
  }
```

Nota: NÃO altere `simulateCosts` nesta task — ela será corrigida na Task 6 (depende do novo tipo `subgroup_id` do motor).

- [ ] **Step 4: Atualizar `src/routers/cost.router.ts`**

Adicionar rotas após `POST /associate` (~linha 52):

```ts
  fastify.post('/associate-subgroup', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.associateSubgroup },
  }, async (request, reply) => {
    try {
      const association = await costService.associateSubgroup(request.body);
      return reply.code(201).send(association);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/associate-batch', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.associateBatch },
  }, async (request, reply) => {
    try {
      const result = await costService.associateBatch(request.body);
      return reply.code(201).send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/associate-subgroup/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const removed = await costService.removeSubgroupAssociation(request.params.id);
      if (!removed) return reply.code(404).send({ error: 'Association not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/subgroup/:subgroupId', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ subgroupId: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const associations = await costService.getAssociationsBySubgroup(request.params.subgroupId);
      return reply.send({ associations });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
```

- [ ] **Step 5: Rodar suíte + lint**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde + sem erros. (O teste `cost.service.integration.test.ts` usa `type: "FIXED"` — segue válido.)

- [ ] **Step 6: Commit**

```bash
git add src/schemas/cost.schema.ts src/repositories/cost.repository.ts src/services/cost.service.ts src/routers/cost.router.ts
git commit -m "feat: extend cost components (packaging, monthly, fair) and subgroup/batch association"
```

---

## Task 4: Taxa de crédito (CRUD)

**Files:**
- Create: `src/schemas/credit-fee.schema.ts`
- Create: `src/repositories/credit-fee.repository.ts`
- Create: `src/services/credit-fee.service.ts`
- Create: `src/routers/credit-fee.router.ts`
- Create: `src/services/credit-fee.service.integration.test.ts`
- Modify: `src/server.ts` (import + register)

**Interfaces:**
- Produces:
  - `creditFeeService.listTiers()`, `updateTier(id, {percent, fixed_fee, is_active})`.
  - `creditFeeRepository.listActive()`, `findById(id)`, `findByInstallments(n)`, `update(id, data)`.
- Consumes: seed do Task 1 (`credit_fee_tiers` com 1x/2x/3x).

- [ ] **Step 1: Teste que falha**

`src/services/credit-fee.service.integration.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { creditFeeService } from "./credit-fee.service.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CreditFeeService Integration Tests", () => {
  before(async () => { await cleanupDatabase(); });
  after(async () => { await cleanupDatabase(); await closeDatabase(); });

  it("lists seeded tiers (1x/2x/3x)", async () => {
    const tiers = await creditFeeService.listTiers();
    assert.strictEqual(tiers.length, 3);
    const one = tiers.find((t: any) => Number(t.installments) === 1)!;
    assert.strictEqual(Number(one.percent), 5.19);
    assert.strictEqual(Number(one.fixed_fee), 0.35);
  });

  it("updates a tier without affecting others", async () => {
    const tiers = await creditFeeService.listTiers();
    const two = tiers.find((t: any) => Number(t.installments) === 2)!;
    await creditFeeService.updateTier(two.id, { percent: 6.99 });
    const updated = await creditFeeService.listTiers();
    const found = updated.find((t: any) => t.id === two.id)!;
    assert.strictEqual(Number(found.percent), 6.99);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx tsx --test src/services/credit-fee.service.integration.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Schema**

`src/schemas/credit-fee.schema.ts`:

```ts
import { z } from "zod";

export const CreditFeeSchema = {
  update: z.object({
    percent: z.number().min(0).optional(),
    fixed_fee: z.number().min(0).optional(),
    is_active: z.boolean().optional(),
  }),
};

export type CreditFeeUpdate = z.input<typeof CreditFeeSchema.update>;
```

- [ ] **Step 4: Repository**

`src/repositories/credit-fee.repository.ts`:

```ts
import { db } from '../lib/db.js';

export class CreditFeeRepository {
  private table = 'credit_fee_tiers';

  async listActive() {
    return db(this.table).whereNull('deleted_at').where('is_active', true).orderBy('installments', 'asc');
  }

  async findById(id: string) {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  async findByInstallments(n: number) {
    return (await db(this.table).where({ installments: n }).whereNull('deleted_at').first()) || null;
  }

  async update(id: string, data: { percent?: number; fixed_fee?: number; is_active?: boolean }) {
    const [row] = await db(this.table)
      .where({ id }).whereNull('deleted_at')
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return row || null;
  }
}

export const creditFeeRepository = new CreditFeeRepository();
```

- [ ] **Step 5: Service**

`src/services/credit-fee.service.ts`:

```ts
import { creditFeeRepository } from '../repositories/credit-fee.repository.js';
import { CreditFeeSchema, type CreditFeeUpdate } from '../schemas/credit-fee.schema.js';

export class CreditFeeService {
  async listTiers() {
    return creditFeeRepository.listActive();
  }

  async updateTier(id: string, data: CreditFeeUpdate) {
    const v = CreditFeeSchema.update.parse(data);
    const existing = await creditFeeRepository.findById(id);
    if (!existing) throw new Error('Credit fee tier not found');
    return creditFeeRepository.update(id, v);
  }
}

export const creditFeeService = new CreditFeeService();
```

- [ ] **Step 6: Router**

`src/routers/credit-fee.router.ts`:

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { creditFeeService } from '../services/credit-fee.service.js';
import { CreditFeeSchema } from '../schemas/credit-fee.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const creditFeeRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
  }, async (request, reply) => {
    try {
      return reply.send(await creditFeeService.listTiers());
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: CreditFeeSchema.update },
  }, async (request, reply) => {
    try {
      const tier = await creditFeeService.updateTier(request.params.id, request.body);
      if (!tier) return reply.code(404).send({ error: 'Credit fee tier not found' });
      return reply.send(tier);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
```

- [ ] **Step 7: Registrar no server**

Em `src/server.ts`:

```ts
import { creditFeeRoutes } from './routers/credit-fee.router.js';
```

```ts
app.register(creditFeeRoutes, { prefix: '/api/credit-fee-tiers' });
```

- [ ] **Step 8: Rodar teste, lint, typecheck**

Run: `npx tsx --test src/services/credit-fee.service.integration.test.ts && npm run lint && npx tsc --noEmit`
Expected: PASS + sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/schemas/credit-fee.schema.ts src/repositories/credit-fee.repository.ts src/services/credit-fee.service.ts src/routers/credit-fee.router.ts src/services/credit-fee.service.integration.test.ts src/server.ts
git commit -m "feat: add credit fee tiers CRUD"
```

---

## Task 5: Estender o motor por venda (`cost-engine.ts`)

**Files:**
- Modify: `src/lib/cost-engine.ts`
- Modify: `src/lib/cost-engine.test.ts`

**Interfaces:**
- Consumes: nenhum (puro).
- Produces (novos):
  - `CostComponentType` inclui `PACKAGING | MONTHLY_FIXED | MONTHLY_PERCENT`.
  - `CostComponentCategory` inclui `ACQUISITION | CREDIT_FEE`.
  - `CostComponentInput` ganha `max_products_per_package?`, `consolidates?`, `applies_to_fair_only?`.
  - `CostEngineItemInput` ganha `subgroup_id: string | null`.
  - `OrderLevelInput` ganha `is_fair?`, `credit_fee?: { percent; fixed_fee } | null`, `total_amount?`.
  - `computeOrderCosts` mantém retorno `OrderCostResult`.

- [ ] **Step 1: Reescrever `src/lib/cost-engine.ts`**

Substituir o conteúdo inteiro por:

```ts
export type CostComponentType =
  | "FIXED" | "PERCENT" | "PER_ORDER" | "PACKAGING" | "MONTHLY_FIXED" | "MONTHLY_PERCENT";
export type CostComponentCategory =
  | "PACKAGING" | "TAX" | "FEE" | "SHIPPING" | "OPERATIONAL"
  | "MARKETING" | "OTHER" | "ACQUISITION" | "CREDIT_FEE";
export type CalculationBase = "PRICE" | "COST";

type SnapshotCategory = "PACKAGING" | "TAX" | "FEE" | "SHIPPING" | "OPERATIONAL" | "MARKETING" | "OTHER";

export interface CostComponentInput {
  id: string;
  name: string;
  type: CostComponentType;
  category: CostComponentCategory;
  value: number;
  calculation_base: CalculationBase;
  quantity: number;
  max_products_per_package?: number | null;
  consolidates?: boolean;
  applies_to_fair_only?: boolean;
}

export interface CostEngineItemInput {
  variant_id: string;
  product_id: string;
  subgroup_id: string | null;
  unit_price: number;
  quantity: number;
  product_cost: number;
  legacy_packaging_cost: number;
  legacy_platform_fee_percent: number;
  components: CostComponentInput[];
}

export interface OrderLevelInput {
  shipping_cost_owner: number;
  discount_amount: number;
  is_fair?: boolean;
  credit_fee?: { percent: number; fixed_fee: number } | null;
  total_amount?: number;
}

export interface CostBreakdownEntry {
  component_id: string | null;
  name: string;
  type: string;
  category: string;
  unit_value: number;
  quantity: number;
  line_total: number;
}

export interface ItemCostSnapshot {
  variant_id: string;
  unit_cost: number;
  unit_packaging_cost: number;
  unit_platform_fee: number;
  unit_tax: number;
  unit_shipping_cost: number;
  unit_operational_cost: number;
  unit_marketing_cost: number;
  unit_other_cost: number;
  unit_total_cost: number;
  unit_profit: number;
  margin_percent: number;
  cost_breakdown: CostBreakdownEntry[];
}

export interface OrderCostResult {
  items: ItemCostSnapshot[];
  total_cost: number;
  total_profit: number;
  margin_percent: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface PerOrderFee {
  id: string | null;
  value: number;
  category: SnapshotCategory;
  name: string;
}

interface ItemBaseCost {
  input: CostEngineItemInput;
  acquisition: number;
  perUnit: Record<SnapshotCategory, number>;
  breakdown: CostBreakdownEntry[];
  perOrderFees: PerOrderFee[];
}

function computeItemBase(input: CostEngineItemInput, isFair: boolean): ItemBaseCost {
  const perUnit: Record<SnapshotCategory, number> = {
    PACKAGING: 0, TAX: 0, FEE: 0, SHIPPING: 0, OPERATIONAL: 0, MARKETING: 0, OTHER: 0,
  };
  let acquisition = 0;
  const breakdown: CostBreakdownEntry[] = [];
  const perOrderFees: PerOrderFee[] = [];

  const acquisitionComponents = input.components.filter(
    (c) => c.type === "FIXED" && c.category === "ACQUISITION" && !(c.applies_to_fair_only && !isFair)
  );

  if (acquisitionComponents.length > 0) {
    for (const c of acquisitionComponents) {
      const unitValue = c.value * c.quantity;
      acquisition += unitValue;
      breakdown.push({ component_id: c.id, name: c.name, type: "FIXED", category: "ACQUISITION", unit_value: unitValue, quantity: 1, line_total: unitValue });
    }
  } else {
    acquisition = input.product_cost;
    breakdown.push({ component_id: null, name: "Custo do produto", type: "PRODUCT", category: "PRODUCT", unit_value: input.product_cost, quantity: 1, line_total: input.product_cost });
  }

  if (input.components.length === 0) {
    const packaging = input.legacy_packaging_cost || 0;
    const fee = input.legacy_platform_fee_percent
      ? (input.unit_price * input.legacy_platform_fee_percent) / 100
      : 0;
    perUnit.PACKAGING = packaging;
    perUnit.FEE = fee;
    if (packaging) breakdown.push({ component_id: null, name: "Embalagem (legado)", type: "FIXED", category: "PACKAGING", unit_value: packaging, quantity: 1, line_total: packaging });
    if (fee) breakdown.push({ component_id: null, name: "Taxa da plataforma (legado)", type: "PERCENT", category: "FEE", unit_value: fee, quantity: 1, line_total: fee });
    return { input, acquisition, perUnit, breakdown, perOrderFees };
  }

  for (const c of input.components) {
    if (c.type === "MONTHLY_FIXED" || c.type === "MONTHLY_PERCENT" || c.type === "PACKAGING") continue;
    if (c.applies_to_fair_only && !isFair) continue;

    if (c.type === "PER_ORDER") {
      perOrderFees.push({ id: c.id, value: c.value, category: (c.category as SnapshotCategory), name: c.name });
      continue;
    }

    let unitValue = 0;
    if (c.type === "FIXED") {
      unitValue = c.value * c.quantity;
    } else if (c.type === "PERCENT") {
      const base = c.calculation_base === "COST" ? input.product_cost : input.unit_price;
      unitValue = (base * c.value) / 100;
    }

    if (c.category === "ACQUISITION") {
      acquisition += unitValue;
    } else {
      perUnit[c.category as SnapshotCategory] += unitValue;
    }
    breakdown.push({ component_id: c.id, name: c.name, type: c.type, category: c.category, unit_value: unitValue, quantity: 1, line_total: unitValue });
  }

  return { input, acquisition, perUnit, breakdown, perOrderFees };
}

interface PackagingBox {
  component_id: string;
  name: string;
  boxes: number;
  cost: number;
}

function computePackaging(items: CostEngineItemInput[], isFair: boolean): { totalCost: number; boxes: PackagingBox[] } {
  const bySubgroup = new Map<string, { component: CostComponentInput; qty: number }>();

  for (const item of items) {
    for (const c of item.components) {
      if (c.type !== "PACKAGING") continue;
      if (c.applies_to_fair_only && !isFair) continue;
      const key = item.subgroup_id ?? "";
      const existing = bySubgroup.get(key);
      if (existing) existing.qty += item.quantity;
      else bySubgroup.set(key, { component: c, qty: item.quantity });
    }
  }

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const entries = [...bySubgroup.values()];

  const consolidators = entries.filter((e) => e.component.consolidates && e.qty > 0);
  if (consolidators.length > 0) {
    const best = consolidators.reduce((a, b) =>
      ((b.component.max_products_per_package ?? 0) > (a.component.max_products_per_package ?? 0) ? b : a));
    const capacity = Math.max(best.component.max_products_per_package ?? 1, 1);
    const boxes = Math.ceil(totalQty / capacity);
    const cost = round2(boxes * best.component.value);
    return { totalCost: cost, boxes: [{ component_id: best.component.id, name: best.component.name, boxes, cost }] };
  }

  let totalCost = 0;
  const boxes: PackagingBox[] = [];
  for (const e of entries) {
    if (e.qty === 0) continue;
    const capacity = Math.max(e.component.max_products_per_package ?? 1, 1);
    const b = Math.ceil(e.qty / capacity);
    const cost = round2(b * e.component.value);
    totalCost += cost;
    boxes.push({ component_id: e.component.id, name: e.component.name, boxes: b, cost });
  }
  return { totalCost: round2(totalCost), boxes };
}

export function computeOrderCosts(
  items: CostEngineItemInput[],
  orderLevel: OrderLevelInput
): OrderCostResult {
  const isFair = orderLevel.is_fair ?? false;
  const baseCosts = items.map((i) => computeItemBase(i, isFair));
  const totalWeight = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const freight = orderLevel.shipping_cost_owner || 0;

  const packaging = computePackaging(items, isFair);

  const creditFee = orderLevel.credit_fee
    ? round2((orderLevel.total_amount ?? 0) * orderLevel.credit_fee.percent / 100 + orderLevel.credit_fee.fixed_fee)
    : 0;

  const allPerOrderFees: PerOrderFee[] = baseCosts.reduce((acc, b) => acc.concat(b.perOrderFees), [] as PerOrderFee[]);
  if (creditFee > 0) allPerOrderFees.push({ id: null, value: creditFee, category: "FEE", name: "Taxa de crédito" });

  const snapshots: ItemCostSnapshot[] = baseCosts.map((b) => {
    const { input } = b;
    const weight = input.unit_price * input.quantity;
    const share = totalWeight > 0 ? weight / totalWeight : 0;

    const perUnit: Record<SnapshotCategory, number> = { ...b.perUnit };

    if (share > 0) {
      perUnit.SHIPPING += round2((freight * share) / input.quantity);
      perUnit.PACKAGING += round2((packaging.totalCost * share) / input.quantity);
    }
    for (const f of allPerOrderFees) {
      perUnit[f.category] += round2((f.value * share) / input.quantity);
    }

    const allocationBreakdown: CostBreakdownEntry[] = [];
    if (share > 0 && freight > 0) {
      const freightAllocation = round2((freight * share) / input.quantity);
      allocationBreakdown.push({ component_id: null, name: "Frete (rateado)", type: "ALLOCATION", category: "SHIPPING", unit_value: freightAllocation, quantity: 1, line_total: freightAllocation });
    }
    if (share > 0 && packaging.totalCost > 0) {
      const packAlloc = round2((packaging.totalCost * share) / input.quantity);
      allocationBreakdown.push({ component_id: null, name: "Embalagem (rateado)", type: "ALLOCATION", category: "PACKAGING", unit_value: packAlloc, quantity: 1, line_total: packAlloc });
    }
    for (const f of allPerOrderFees) {
      const allocated = round2((f.value * share) / input.quantity);
      if (allocated === 0) continue;
      allocationBreakdown.push({ component_id: f.id, name: `${f.name} (rateado)`, type: "ALLOCATION", category: f.category, unit_value: allocated, quantity: 1, line_total: allocated });
    }

    const unit_total_cost = round2(
      b.acquisition + perUnit.PACKAGING + perUnit.TAX + perUnit.FEE +
      perUnit.SHIPPING + perUnit.OPERATIONAL + perUnit.MARKETING + perUnit.OTHER
    );

    const grossRevenue = input.unit_price * input.quantity;
    const discountShare = totalWeight > 0 ? (orderLevel.discount_amount || 0) * share : 0;
    const netUnitRevenue = input.quantity > 0 ? (grossRevenue - discountShare) / input.quantity : 0;
    const unit_profit = round2(netUnitRevenue - unit_total_cost);
    const margin_percent = netUnitRevenue > 0 ? round2((unit_profit / netUnitRevenue) * 100) : 0;

    return {
      variant_id: input.variant_id,
      unit_cost: round2(b.acquisition),
      unit_packaging_cost: round2(perUnit.PACKAGING),
      unit_platform_fee: round2(perUnit.FEE),
      unit_tax: round2(perUnit.TAX),
      unit_shipping_cost: round2(perUnit.SHIPPING),
      unit_operational_cost: round2(perUnit.OPERATIONAL),
      unit_marketing_cost: round2(perUnit.MARKETING),
      unit_other_cost: round2(perUnit.OTHER),
      unit_total_cost,
      unit_profit,
      margin_percent,
      cost_breakdown: [...b.breakdown, ...allocationBreakdown],
    };
  });

  const exactTotalCost = items.reduce((sum, item, idx) => sum + snapshots[idx]!.unit_total_cost * item.quantity, 0);
  const orderTotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const netRevenue = orderTotal - (orderLevel.discount_amount || 0);
  const total_profit = round2(netRevenue - exactTotalCost);
  const margin_percent = netRevenue > 0 ? round2((total_profit / netRevenue) * 100) : 0;

  return { items: snapshots, total_cost: round2(exactTotalCost), total_profit, margin_percent };
}
```

- [ ] **Step 2: Atualizar `src/lib/cost-engine.test.ts`**

Em `baseItem` (linhas 5-17), adicionar `subgroup_id: null,` após `product_id`. No teste "ignores MONTHLY components" (linhas 91-97), trocar `type: "MONTHLY"` por `type: "MONTHLY_FIXED"` e renomear para `it("ignores MONTHLY_FIXED components at sale time", ...)`.

- [ ] **Step 3: Adicionar novos testes ao `cost-engine.test.ts`**

Anexar ao `describe("CostEngine", ...)`:

```ts
  it("uses ACQUISITION components as unit_cost instead of product_cost", () => {
    const item = baseItem({
      components: [
        { id: "c1", name: "Aquisição", type: "FIXED", category: "ACQUISITION", value: 10, calculation_base: "PRICE", quantity: 2 },
      ],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_cost, 20);
    assert.strictEqual(result.items[0]!.unit_total_cost, 20);
  });

  it("computes packaging boxes by capacity (no consolidation)", () => {
    const packaging = { id: "pk", name: "Caixa A", type: "PACKAGING" as const, category: "PACKAGING" as const, value: 3, calculation_base: "PRICE" as const, quantity: 1, max_products_per_package: 6 };
    const items = [1, 2, 3, 4, 5, 6, 7].map((n) => baseItem({
      variant_id: `v${n}`, subgroup_id: "sg-a", unit_price: 10, quantity: 1, components: [packaging],
    }));
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 0 });
    const totalPack = result.items.reduce((s, i) => s + i.unit_packaging_cost, 0);
    assert.strictEqual(result.total_cost, 7 * 40 + 6);
    assert.strictEqual(Math.round(totalPack * 100) / 100, 6);
  });

  it("consolidator packaging absorbs other packaging", () => {
    const packA = { id: "pkA", name: "Caixa A", type: "PACKAGING" as const, category: "PACKAGING" as const, value: 3, calculation_base: "PRICE" as const, quantity: 1, max_products_per_package: 6, consolidates: false };
    const packB = { id: "pkB", name: "Caixa B", type: "PACKAGING" as const, category: "PACKAGING" as const, value: 9, calculation_base: "PRICE" as const, quantity: 1, max_products_per_package: 6, consolidates: true };
    const items = [
      baseItem({ variant_id: "a1", subgroup_id: "sg-a", unit_price: 10, quantity: 5, components: [packA] }),
      baseItem({ variant_id: "b1", subgroup_id: "sg-b", unit_price: 10, quantity: 1, components: [packB] }),
    ];
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 0 });
    const totalPack = result.items.reduce((s, i) => s + i.unit_packaging_cost * i.quantity, 0);
    assert.strictEqual(Math.round(totalPack * 100) / 100, 9);
  });

  it("applies credit fee by installments and total_amount", () => {
    const item = baseItem({ unit_price: 100, quantity: 1 });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0, total_amount: 100, credit_fee: { percent: 5.19, fixed_fee: 0.35 } });
    assert.strictEqual(result.items[0]!.unit_platform_fee, 5.54);
  });

  it("applies fair-only components only when is_fair", () => {
    const fairComp = { id: "fair", name: "Custo feira", type: "FIXED" as const, category: "OTHER" as const, value: 5, calculation_base: "PRICE" as const, quantity: 1, applies_to_fair_only: true };
    const item = baseItem({ components: [fairComp] });
    const notFair = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0, is_fair: false });
    assert.strictEqual(notFair.items[0]!.unit_other_cost, 0);
    const fair = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0, is_fair: true });
    assert.strictEqual(fair.items[0]!.unit_other_cost, 5);
  });
```

- [ ] **Step 4: Rodar o teste do motor**

Run: `npx tsx --test src/lib/cost-engine.test.ts`
Expected: PASS (antigos + novos). Se algum teste antigo falhar por conta do `subgroup_id` obrigatório, verifique que `baseItem` foi atualizado no Step 2.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cost-engine.ts src/lib/cost-engine.test.ts
git commit -m "feat: extend cost engine with acquisition, packaging, credit fee and fair costs"
```

---

## Task 6: Conectar o motor por venda aos pedidos (Nuvemshop + externo + simulate)

**Files:**
- Modify: `src/repositories/order.repository.ts`
- Modify: `src/schemas/external-sale.schema.ts`
- Modify: `src/repositories/external-sale.repository.ts`
- Modify: `src/services/external-sale.service.ts`
- Modify: `src/services/cost.service.ts` (`simulateCosts`)

**Interfaces:**
- Consumes: `costRepository.getComponentsBySubgroupIds` (Task 3), `creditFeeRepository.findByInstallments` (Task 4), `computeOrderCosts` novo (Task 5).
- Produces: pedidos (Nuvemshop e externos) gravam `is_fair` e snapshot incluindo aquisição/embalagem/taxa de crédito/feira.

- [ ] **Step 1: Atualizar `src/schemas/external-sale.schema.ts`**

No `create` (linhas 10-21), adicionar após `status`:

```ts
    is_fair: z.boolean().optional(),
```

Na `response` (após `margin_percent`, ~linha 38), adicionar:

```ts
    is_fair: z.boolean().nullable().optional(),
```

- [ ] **Step 2: Atualizar `src/services/external-sale.service.ts`**

Adicionar import (após linha 3):

```ts
import { creditFeeRepository } from '../repositories/credit-fee.repository.js';
```

Substituir TODO o bloco da linha 13 até a linha 49 (do `const variantIds` até o `const costResult = computeOrderCosts(...)` inclusive) por:

```ts
    const variantIds = validated.items.map(i => i.variant_id);
    const variants = await db('product_variants')
      .join('products', 'products.id', 'product_variants.product_id')
      .whereIn('product_variants.id', variantIds)
      .whereNull('product_variants.deleted_at')
      .select('product_variants.id', 'product_variants.product_id', 'products.subgroup_id', 'product_variants.cost_price', 'product_variants.packaging_cost', 'product_variants.platform_fee_percent');
    if (variants.length !== variantIds.length) {
      throw new Error('One or more variants were not found');
    }
    const variantMap = new Map(variants.map(v => [v.id, v]));
    const productIds = [...new Set(variants.map(v => v.product_id))];
    const subgroupIds = [...new Set(variants.map(v => v.subgroup_id).filter(Boolean))] as string[];

    const toComponent = (c: any) => ({
      id: c.id, name: c.name, type: c.type, category: c.category,
      value: Number(c.value), calculation_base: c.calculation_base, quantity: c.quantity,
      max_products_per_package: c.max_products_per_package,
      consolidates: c.consolidates,
      applies_to_fair_only: c.applies_to_fair_only,
    });

    const componentsByProduct = new Map<string, any[]>();
    for (const row of await costRepository.getComponentsByProductIds(productIds)) {
      if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
      componentsByProduct.get(row.product_id)!.push(row);
    }
    const componentsBySubgroup = new Map<string, any[]>();
    for (const row of await costRepository.getComponentsBySubgroupIds(subgroupIds)) {
      if (!componentsBySubgroup.has(row.subgroup_id)) componentsBySubgroup.set(row.subgroup_id, []);
      componentsBySubgroup.get(row.subgroup_id)!.push(row);
    }

    const installments = validated.payment_installments ?? 1;
    const creditTier = await creditFeeRepository.findByInstallments(installments);

    const engineItems: CostEngineItemInput[] = validated.items.map(item => {
      const v = variantMap.get(item.variant_id)!;
      const productComps = (componentsByProduct.get(v.product_id) || []).map(toComponent);
      const subgroupComps = v.subgroup_id ? (componentsBySubgroup.get(v.subgroup_id) || []).map(toComponent) : [];
      return {
        variant_id: item.variant_id,
        product_id: v.product_id,
        subgroup_id: v.subgroup_id ?? null,
        unit_price: item.unit_price,
        quantity: item.quantity,
        product_cost: Number(v.cost_price || 0),
        legacy_packaging_cost: Number(v.packaging_cost || 0),
        legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
        components: [...productComps, ...subgroupComps],
      };
    });

    const grossTotal = engineItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const totalAmount = grossTotal - (validated.discount_amount ?? 0);

    const costResult = computeOrderCosts(engineItems, {
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      discount_amount: validated.discount_amount ?? 0,
      is_fair: validated.is_fair ?? false,
      credit_fee: creditTier ? { percent: Number(creditTier.percent), fixed_fee: Number(creditTier.fixed_fee) } : null,
      total_amount: totalAmount,
    });
```

No objeto `input` (linhas 51-62), adicionar:

```ts
      is_fair: validated.is_fair ?? false,
```

- [ ] **Step 3: Atualizar `src/repositories/external-sale.repository.ts`**

Na interface `ExternalSaleInput` (linhas 10-21), adicionar:

```ts
  is_fair: boolean;
```

No `insert` de `orders` (linhas 35-51), adicionar:

```ts
          is_fair: input.is_fair ?? false,
```

- [ ] **Step 4: Atualizar `src/repositories/order.repository.ts`**

(a) Adicionar import no topo (após linha 4):

```ts
import { creditFeeRepository } from './credit-fee.repository.js';
```

(b) Na interface `Order` (linhas 27-63), adicionar:

```ts
  is_fair: boolean;
  monthly_cost_total: number;
```

(c) Em `create` (linhas 185-213): substituir o bloco inteiro por:

```ts
      // after inserting the order and BEFORE stock deduction, resolve variants + components
      const variantIds = items.map(i => i.variant_id);
      const variants = await trx('product_variants')
        .join('products', 'products.id', 'product_variants.product_id')
        .whereIn('product_variants.id', variantIds)
        .select('product_variants.id', 'product_variants.product_id', 'products.subgroup_id', 'product_variants.cost_price', 'product_variants.packaging_cost', 'product_variants.platform_fee_percent');
      const variantMap = new Map(variants.map(v => [v.id, v]));
      const productIds = [...new Set(variants.map(v => v.product_id))];
      const subgroupIds = [...new Set(variants.map(v => v.subgroup_id).filter(Boolean))] as string[];

      const toComponent = (c: any) => ({
        id: c.id, name: c.name, type: c.type, category: c.category,
        value: Number(c.value), calculation_base: c.calculation_base, quantity: c.quantity,
        max_products_per_package: c.max_products_per_package,
        consolidates: c.consolidates,
        applies_to_fair_only: c.applies_to_fair_only,
      });

      const componentsByProduct = new Map<string, Array<any>>();
      for (const row of await costRepository.getComponentsByProductIds(productIds, trx)) {
        if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
        componentsByProduct.get(row.product_id)!.push(row);
      }
      const componentsBySubgroup = new Map<string, Array<any>>();
      for (const row of await costRepository.getComponentsBySubgroupIds(subgroupIds, trx)) {
        if (!componentsBySubgroup.has(row.subgroup_id)) componentsBySubgroup.set(row.subgroup_id, []);
        componentsBySubgroup.get(row.subgroup_id)!.push(row);
      }

      const engineItems: CostEngineItemInput[] = items.map(item => {
        const v = variantMap.get(item.variant_id);
        if (!v) throw new Error(`Product variant ${item.variant_id} not found`);
        const productComps = (componentsByProduct.get(v.product_id) || []).map(toComponent);
        const subgroupComps = v.subgroup_id ? (componentsBySubgroup.get(v.subgroup_id) || []).map(toComponent) : [];
        return {
          variant_id: item.variant_id,
          product_id: v.product_id,
          subgroup_id: v.subgroup_id ?? null,
          unit_price: item.unit_price,
          quantity: item.quantity,
          product_cost: Number(v.cost_price || 0),
          legacy_packaging_cost: Number(v.packaging_cost || 0),
          legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
          components: [...productComps, ...subgroupComps],
        };
      });

      const costResult = computeOrderCosts(engineItems, {
        shipping_cost_owner: 0,
        discount_amount: 0,
        is_fair: false,
        credit_fee: null,
        total_amount: Number(order.total_amount),
      });
```

(d) Em `upsertOrderFromNuvemshop` (linhas 340-378): substituir o bloco inteiro por:

```ts
      const nuvemshopVariantIds = nuvemshopItems.map(item => item.variant_id);
      const internalVariants = await trx('product_variants')
        .join('products', 'products.id', 'product_variants.product_id')
        .whereIn('product_variants.nuvemshop_variant_id', nuvemshopVariantIds)
        .select('product_variants.id', 'product_variants.nuvemshop_variant_id', 'product_variants.product_id', 'products.subgroup_id', 'product_variants.cost_price', 'product_variants.packaging_cost', 'product_variants.platform_fee_percent');

      const variantMap = new Map(internalVariants.map(v => [v.nuvemshop_variant_id, v]));

      const productIds = [...new Set(internalVariants.map(v => v.product_id))];
      const subgroupIds = [...new Set(internalVariants.map(v => v.subgroup_id).filter(Boolean))] as string[];

      const toComponent = (c: any) => ({
        id: c.id, name: c.name, type: c.type, category: c.category,
        value: Number(c.value), calculation_base: c.calculation_base, quantity: c.quantity,
        max_products_per_package: c.max_products_per_package,
        consolidates: c.consolidates,
        applies_to_fair_only: c.applies_to_fair_only,
      });

      const componentsByProduct = new Map<string, Array<any>>();
      for (const row of await costRepository.getComponentsByProductIds(productIds, trx)) {
        if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
        componentsByProduct.get(row.product_id)!.push(row);
      }
      const componentsBySubgroup = new Map<string, Array<any>>();
      for (const row of await costRepository.getComponentsBySubgroupIds(subgroupIds, trx)) {
        if (!componentsBySubgroup.has(row.subgroup_id)) componentsBySubgroup.set(row.subgroup_id, []);
        componentsBySubgroup.get(row.subgroup_id)!.push(row);
      }

      const engineItems: CostEngineItemInput[] = [];
      for (const nuvemshopItem of nuvemshopItems) {
        const internalVariant = variantMap.get(nuvemshopItem.variant_id);
        if (!internalVariant) continue;
        const productComps = (componentsByProduct.get(internalVariant.product_id) || []).map(toComponent);
        const subgroupComps = internalVariant.subgroup_id ? (componentsBySubgroup.get(internalVariant.subgroup_id) || []).map(toComponent) : [];
        engineItems.push({
          variant_id: internalVariant.id,
          product_id: internalVariant.product_id,
          subgroup_id: internalVariant.subgroup_id ?? null,
          unit_price: nuvemshopItem.price,
          quantity: nuvemshopItem.quantity,
          product_cost: Number(internalVariant.cost_price || 0),
          legacy_packaging_cost: Number(internalVariant.packaging_cost || 0),
          legacy_platform_fee_percent: Number(internalVariant.platform_fee_percent || 0),
          components: [...productComps, ...subgroupComps],
        });
      }

      const installments = order.payment_installments ?? 1;
      const creditTier = await creditFeeRepository.findByInstallments(installments);
      const costResult = computeOrderCosts(engineItems, {
        shipping_cost_owner: data.shipping_cost_owner ? parseFloat(data.shipping_cost_owner) : 0,
        discount_amount: data.discount ? parseFloat(data.discount) : 0,
        is_fair: false,
        credit_fee: creditTier ? { percent: Number(creditTier.percent), fixed_fee: Number(creditTier.fixed_fee) } : null,
        total_amount: Number(order.total_amount),
      });
```

- [ ] **Step 5: Atualizar `simulateCosts` em `src/services/cost.service.ts`**

Substituir o método `simulateCosts` (linhas 62-96) por:

```ts
  async simulateCosts(input: CostSimulateInput) {
    const validated = CostSchema.simulate.parse(input);
    const variant = await db('product_variants')
      .join('products', 'products.id', 'product_variants.product_id')
      .where('product_variants.id', validated.variant_id)
      .whereNull('product_variants.deleted_at')
      .select('product_variants.id', 'product_variants.product_id', 'products.subgroup_id', 'product_variants.cost_price', 'product_variants.packaging_cost', 'product_variants.platform_fee_percent')
      .first();
    if (!variant) throw new Error('Product variant not found');

    const toComponent = (c: any) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      category: c.category,
      value: Number(c.value),
      calculation_base: c.calculation_base,
      quantity: c.quantity,
      max_products_per_package: c.max_products_per_package,
      consolidates: c.consolidates,
      applies_to_fair_only: c.applies_to_fair_only,
    });

    const productComps = (await costRepository.getComponentsByProductIds([variant.product_id])).map(toComponent);
    const subgroupComps = variant.subgroup_id
      ? (await costRepository.getComponentsBySubgroupIds([variant.subgroup_id])).map(toComponent)
      : [];

    const result = computeOrderCosts(
      [{
        variant_id: variant.id,
        product_id: variant.product_id,
        subgroup_id: variant.subgroup_id ?? null,
        unit_price: validated.unit_price,
        quantity: validated.quantity,
        product_cost: Number(variant.cost_price || 0),
        legacy_packaging_cost: Number(variant.packaging_cost || 0),
        legacy_platform_fee_percent: Number(variant.platform_fee_percent || 0),
        components: [...productComps, ...subgroupComps],
      }],
      { shipping_cost_owner: 0, discount_amount: 0 }
    );

    return result.items[0];
  }
```

Remova o import agora não usado do tipo `CostSimulateInput`? NÃO — `CostSimulateInput` continua usado como tipo do parâmetro. (Mantenha o import existente.)

- [ ] **Step 6: Rodar suíte completa**

Run: `npm test`
Expected: verde (pedidos, venda externa, custo).

- [ ] **Step 7: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/repositories/order.repository.ts src/schemas/external-sale.schema.ts src/repositories/external-sale.repository.ts src/services/external-sale.service.ts src/services/cost.service.ts
git commit -m "feat: wire per-sale engine (subgroups, credit fee, fair) into orders, external sales and simulate"
```

---

## Task 7: Engine de fechamento mensal (lib pura)

**Files:**
- Create: `src/lib/monthly-cost-engine.ts`
- Create: `src/lib/monthly-cost-engine.test.ts`

**Interfaces:**
- Produces:
  - `MonthlyComponent = { id; name; type: "MONTHLY_FIXED"|"MONTHLY_PERCENT"; value; allocation_basis: "PER_ORDER"|"PER_PRODUCT" }`.
  - `MonthlyAggregate = { revenue; order_count; product_count; orders: Array<{ order_id; product_count }> }`.
  - `MonthlyAllocation = { order_id; cost_component_id; amount }`.
  - `computeMonthlyAllocations(components, agg): MonthlyAllocation[]`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/monthly-cost-engine.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeMonthlyAllocations } from "./monthly-cost-engine.js";

const orders = [
  { order_id: "o1", product_count: 2 },
  { order_id: "o2", product_count: 1 },
];

describe("MonthlyCostEngine", () => {
  it("distributes MONTHLY_FIXED equally by order", () => {
    const agg = { revenue: 1000, order_count: 2, product_count: 3, orders };
    const allocs = computeMonthlyAllocations([
      { id: "c1", name: "Equipe", type: "MONTHLY_FIXED", value: 100, allocation_basis: "PER_ORDER" },
    ], agg);
    assert.strictEqual(allocs.length, 2);
    assert.strictEqual(allocs.reduce((s, a) => s + a.amount, 0), 100);
    assert.strictEqual(allocs.find(a => a.order_id === "o1")!.amount, 50);
  });

  it("distributes MONTHLY_FIXED by product", () => {
    const agg = { revenue: 1000, order_count: 2, product_count: 3, orders };
    const allocs = computeMonthlyAllocations([
      { id: "c1", name: "Equipe", type: "MONTHLY_FIXED", value: 300, allocation_basis: "PER_PRODUCT" },
    ], agg);
    assert.strictEqual(allocs.find(a => a.order_id === "o1")!.amount, 200);
    assert.strictEqual(allocs.find(a => a.order_id === "o2")!.amount, 100);
  });

  it("computes MONTHLY_PERCENT over revenue", () => {
    const agg = { revenue: 1000, order_count: 2, product_count: 3, orders };
    const allocs = computeMonthlyAllocations([
      { id: "c2", name: "Imposto", type: "MONTHLY_PERCENT", value: 10, allocation_basis: "PER_ORDER" },
    ], agg);
    assert.strictEqual(allocs.reduce((s, a) => s + a.amount, 0), 100);
  });

  it("returns empty when there are no orders", () => {
    const agg = { revenue: 0, order_count: 0, product_count: 0, orders: [] };
    const allocs = computeMonthlyAllocations([
      { id: "c1", name: "Equipe", type: "MONTHLY_FIXED", value: 100, allocation_basis: "PER_ORDER" },
    ], agg);
    assert.strictEqual(allocs.length, 0);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx tsx --test src/lib/monthly-cost-engine.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

`src/lib/monthly-cost-engine.ts`:

```ts
export type MonthlyComponentType = "MONTHLY_FIXED" | "MONTHLY_PERCENT";
export type AllocationBasis = "PER_ORDER" | "PER_PRODUCT";

export interface MonthlyComponent {
  id: string;
  name: string;
  type: MonthlyComponentType;
  value: number;
  allocation_basis: AllocationBasis;
}

export interface MonthlyOrderRow {
  order_id: string;
  product_count: number;
}

export interface MonthlyAggregate {
  revenue: number;
  order_count: number;
  product_count: number;
  orders: MonthlyOrderRow[];
}

export interface MonthlyAllocation {
  order_id: string;
  cost_component_id: string;
  amount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeMonthlyAllocations(
  components: MonthlyComponent[],
  agg: MonthlyAggregate
): MonthlyAllocation[] {
  const allocations: MonthlyAllocation[] = [];

  for (const c of components) {
    const total = c.type === "MONTHLY_PERCENT"
      ? (agg.revenue * c.value) / 100
      : c.value;

    if (agg.order_count === 0) continue;

    if (c.allocation_basis === "PER_PRODUCT") {
      if (agg.product_count === 0) continue;
      const perProduct = total / agg.product_count;
      for (const o of agg.orders) {
        const amount = round2(perProduct * o.product_count);
        if (amount === 0) continue;
        allocations.push({ order_id: o.order_id, cost_component_id: c.id, amount });
      }
    } else {
      const perOrder = total / agg.order_count;
      const base = round2(perOrder);
      const remainder = round2(total - base * agg.order_count);
      agg.orders.forEach((o, idx) => {
        const amount = idx === agg.orders.length - 1 ? base + remainder : base;
        if (amount === 0) return;
        allocations.push({ order_id: o.order_id, cost_component_id: c.id, amount });
      });
    }
  }

  return allocations;
}
```

- [ ] **Step 4: Rodar o teste**

Run: `npx tsx --test src/lib/monthly-cost-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monthly-cost-engine.ts src/lib/monthly-cost-engine.test.ts
git commit -m "feat: add monthly cost allocation engine"
```

---

## Task 8: Fechamento mensal (repository + service + router)

**Files:**
- Create: `src/repositories/cost-closing.repository.ts`
- Create: `src/services/cost-closing.service.ts`
- Create: `src/routers/cost-closing.router.ts`
- Create: `src/services/cost-closing.service.integration.test.ts`
- Modify: `src/server.ts` (import + register)

**Interfaces:**
- Consumes: `computeMonthlyAllocations`, `MonthlyComponent` (Task 7); `cost_components`/`orders`/`order_items` no DB.
- Produces: `costClosingService.closeMonth(input)` → `{ period: { start, end }, components, orders, products, allocations }`.

- [ ] **Step 1: Teste que falha**

`src/services/cost-closing.service.integration.test.ts`:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { costClosingService } from "./cost-closing.service.js";
import { costService } from "./cost.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CostClosingService Integration Tests", () => {
  before(async () => { await cleanupDatabase(); });
  after(async () => { await cleanupDatabase(); await closeDatabase(); });

  it("closes a month, distributing a MONTHLY_FIXED component across orders", async () => {
    const component = await costService.createComponent({
      name: "Equipe", type: "MONTHLY_FIXED", value: 1000, allocation_basis: "PER_ORDER",
    } as any);

    const [p] = await db('products').insert({ slug: 'cc-prod', name: 'Prod' }).returning('*');
    const [v] = await db('product_variants').insert({ product_id: p.id, price: 100, stock_quantity: 10 }).returning('*');

    const orderIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [o] = await db('orders').insert({
        customer_name: `C${i}`, status: 'PAID', total_amount: 250, source: 'EXTERNAL', created_at: new Date('2026-08-10T12:00:00Z'),
      }).returning('*');
      await db('order_items').insert({ order_id: o.id, variant_id: v.id, quantity: 1, unit_price: 250, status: true });
      orderIds.push(o.id);
    }

    const result = await costClosingService.closeMonth({ month: '2026-08' });

    assert.strictEqual(result.orders, 4);
    assert.strictEqual(result.allocations, 4);

    const rows = await db('order_monthly_allocations').select('*');
    assert.strictEqual(rows.length, 4);
    const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
    assert.strictEqual(sum, 1000);

    const order = await db('orders').where({ id: orderIds[0] }).first();
    assert.strictEqual(Number(order.monthly_cost_total), 250);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx tsx --test src/services/cost-closing.service.integration.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Repository**

`src/repositories/cost-closing.repository.ts`:

```ts
import { db } from '../lib/db.js';
import type { MonthlyComponent } from '../lib/monthly-cost-engine.js';

function toMonthlyComponent(row: any): MonthlyComponent {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    value: Number(row.value),
    allocation_basis: row.allocation_basis,
  };
}

export class CostClosingRepository {
  async listMonthlyComponents(start: string, end: string): Promise<MonthlyComponent[]> {
    const rows = await db('cost_components')
      .whereNull('deleted_at')
      .where('is_active', true)
      .whereIn('type', ['MONTHLY_FIXED', 'MONTHLY_PERCENT'])
      .andWhere(function (this: any) {
        this.whereNull('period_start').orWhere('period_start', '<=', end);
      })
      .andWhere(function (this: any) {
        this.whereNull('period_end').orWhere('period_end', '>=', start);
      });
    return rows.map(toMonthlyComponent);
  }

  async aggregateOrders(start: string, end: string) {
    const orders = await db('orders')
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .where('created_at', '>=', start)
      .andWhere('created_at', '<', end)
      .select('id', 'total_amount');

    const revenue = orders.reduce((s, o) => s + Number(o.total_amount), 0);

    const orderRows = await db('order_items')
      .join('orders', 'orders.id', 'order_items.order_id')
      .where('orders.created_at', '>=', start)
      .andWhere('orders.created_at', '<', end)
      .where('orders.status', '<>', 'CANCELED')
      .whereNull('orders.deleted_at')
      .where('order_items.status', true)
      .groupBy('orders.id')
      .select('orders.id as order_id', db.raw('COALESCE(SUM(order_items.quantity), 0)::int as product_count'));

    const orderCountByProduct = new Map((orderRows as any[]).map((r) => [r.order_id, Number(r.product_count)]));
    const productCount = [...orderCountByProduct.values()].reduce((s, n) => s + n, 0);

    return {
      revenue,
      order_count: orders.length,
      product_count: productCount,
      orders: orders.map((o: any) => ({
        order_id: o.id,
        product_count: orderCountByProduct.get(o.id) ?? 0,
      })),
    };
  }

  async applyAllocations(
    allocations: Array<{ order_id: string; cost_component_id: string; amount: number }>,
    componentIds: string[],
    start: string,
    end: string
  ) {
    return await db.transaction(async (trx) => {
      if (componentIds.length > 0) {
        await trx('order_monthly_allocations')
          .whereIn('cost_component_id', componentIds)
          .where('period_start', start)
          .where('period_end', end)
          .del();
      }

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

      const perOrder = await trx('order_monthly_allocations')
        .where('period_start', start)
        .where('period_end', end)
        .groupBy('order_id')
        .select('order_id', db.raw('COALESCE(SUM(amount), 0)::float8 as total'));

      for (const row of perOrder as any[]) {
        await trx('orders').where({ id: row.order_id }).update({
          monthly_cost_total: Number(row.total),
          updated_at: new Date(),
        });
      }
    });
  }
}

export const costClosingRepository = new CostClosingRepository();
```

- [ ] **Step 4: Service**

`src/services/cost-closing.service.ts`:

```ts
import { costClosingRepository } from '../repositories/cost-closing.repository.js';
import { computeMonthlyAllocations } from '../lib/monthly-cost-engine.js';
import { z } from 'zod';

const CloseMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function resolvePeriod(input: { month?: string; start_date?: string; end_date?: string }): { start: string; end: string } {
  if (input.month) {
    const [y, m] = input.month.split('-').map(Number);
    const start = new Date(Date.UTC(y!, m! - 1, 1));
    const end = new Date(Date.UTC(y!, m!, 1));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  const start = new Date(`${input.start_date!}T00:00:00.000Z`);
  const end = new Date(`${input.end_date!}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start: input.start_date!,
    end: end.toISOString().slice(0, 10),
  };
}

export class CostClosingService {
  async closeMonth(input: { month?: string; start_date?: string; end_date?: string }) {
    const v = CloseMonthSchema.parse(input);
    if (!v.month && (!v.start_date || !v.end_date)) {
      throw new Error('Provide month or start_date+end_date');
    }

    const { start, end } = resolvePeriod(v);

    const components = await costClosingRepository.listMonthlyComponents(start, end);
    const agg = await costClosingRepository.aggregateOrders(start, end);
    const allocations = computeMonthlyAllocations(components, agg);

    const componentIds = components.map((c) => c.id);
    await costClosingRepository.applyAllocations(allocations, componentIds, start, end);

    return {
      period: { start, end },
      components: components.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        allocation_basis: c.allocation_basis,
      })),
      orders: agg.order_count,
      products: agg.product_count,
      allocations: allocations.length,
    };
  }
}

export const costClosingService = new CostClosingService();
```

- [ ] **Step 5: Router**

`src/routers/cost-closing.router.ts`:

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { costClosingService } from '../services/cost-closing.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const costClosingRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      body: z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    },
  }, async (request, reply) => {
    try {
      return reply.send(await costClosingService.closeMonth(request.body));
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
```

- [ ] **Step 6: Registrar no server**

Em `src/server.ts`:

```ts
import { costClosingRoutes } from './routers/cost-closing.router.js';
```

```ts
app.register(costClosingRoutes, { prefix: '/api/cost-closing' });
```

- [ ] **Step 7: Rodar o teste**

Run: `npx tsx --test src/services/cost-closing.service.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/repositories/cost-closing.repository.ts src/services/cost-closing.service.ts src/routers/cost-closing.router.ts src/services/cost-closing.service.integration.test.ts src/server.ts
git commit -m "feat: add monthly cost closing (distribute monthly costs across orders)"
```

---

## Task 9: Resumo financeiro em camadas na resposta do pedido

**Files:**
- Modify: `src/schemas/order.schema.ts`
- Modify: `src/lib/order-status.ts`
- Modify: `src/repositories/order.repository.ts` (`findById`, `findAll`)

**Interfaces:**
- Consumes: `order_monthly_allocations` (Task 8).
- Produces: resposta do pedido com `is_fair`, `monthly_cost_total`, `total_cost_with_monthly`, `monthly_allocations`.

- [ ] **Step 1: Atualizar `src/lib/order-status.ts`**

No `enrichOrder` (linhas 80-91), adicionar antes do `items`:

```ts
    is_fair: (order as any).is_fair ?? false,
    monthly_cost_total: Number((order as any).monthly_cost_total || 0),
    total_cost_with_monthly: Number(order.total_cost || 0) + Number((order as any).monthly_cost_total || 0),
    monthly_allocations: (order as any).monthly_allocations ?? [],
```

- [ ] **Step 2: Atualizar `src/repositories/order.repository.ts` (leitura)**

Em `findById` (linhas 448-463), após carregar `items`, adicionar carregamento de `monthly_allocations` e incluí-lo no retorno:

```ts
    const monthly_allocations = await db('order_monthly_allocations').where({ order_id: id });

    return {
      ...order,
      items,
      monthly_allocations,
    };
```

Em `findAll` (dentro de `baseOrders.map`, linhas 500-505), fazer o mesmo por pedido:

```ts
      baseOrders.map(async (order) => {
        const items = await db(this.itemsTable)
          .where({ order_id: order.id, status: true });
        const monthly_allocations = await db('order_monthly_allocations').where({ order_id: order.id });
        return { ...order, items, monthly_allocations };
      })
```

- [ ] **Step 3: Atualizar `src/schemas/order.schema.ts`**

Na `OrderResponseShapeSchema` (linhas 50-90), adicionar:

```ts
  is_fair: z.boolean().nullable().optional(),
  monthly_cost_total: z.number().optional(),
  total_cost_with_monthly: z.number().optional(),
  monthly_allocations: z.array(z.object({
    id: z.uuid(),
    order_id: z.uuid(),
    cost_component_id: z.uuid(),
    amount: z.number(),
    period_start: z.string(),
    period_end: z.string(),
  })).optional(),
```

- [ ] **Step 4: Rodar testes + lint**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: verde + sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/order.schema.ts src/lib/order-status.ts src/repositories/order.repository.ts
git commit -m "feat: expose layered financial summary (monthly cost) on order response"
```

---

## Task 10: Verificação final

- [ ] **Step 1: Suíte completa**

Run: `npm test`
Expected: todas as suítes verdes (`cost-closing`, `credit-fee`, `product-subgroup`, `cost-engine`, `monthly-cost-engine`, `order`, `external-sale`, `cost`).

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros nem warnings.

- [ ] **Step 3: Revisão manual do spec**

Confira cobertura do spec: aquisição (Task 5/6), subgrupos + atribuir produtos (Task 2/3), embalagem/consolidação (Task 5/6), taxa de crédito (Task 4/5/6), mensais + fechamento (Task 7/8), feira (Task 5/6), frete (inalterado), resumo em camadas (Task 9), lotes (Task 3), simulate (Task 6).

- [ ] **Step 4: Commit final (se houver resíduos)**

```bash
git status
git add -A
git commit -m "chore: finalize cost engine v2"
```
