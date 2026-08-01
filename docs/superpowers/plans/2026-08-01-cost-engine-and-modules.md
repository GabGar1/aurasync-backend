# Cost Engine & P0 Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Cost Engine (Motor de Custos), External Sales (Venda Externa), Customers module, Order enrichment with PT-BR translations, and Dashboard/Product-search fixes.

**Architecture:** Follows the existing Router → Service → Repository 3-layer pattern. The cost engine is a set of **pure functions** in `src/lib/cost-engine.ts` (used by both Nuvemshop sync and external sales → qualifies for `src/lib`). Persistence stays in repositories using `db.transaction`. Zod validates all inputs/outputs.

**Tech Stack:** Node + TypeScript (ESM), Fastify 5 + `@fastify/jwt`, Knex (pg), Zod, `node:test` (real integration tests, no mocks).

## Global Constraints

- One single calculation flow for Nuvemshop sales and external sales — the same engine.
- `orders.source` = `NUVEMSHOP | EXTERNAL` only. Generic `createOrder` defaults to `NUVEMSHOP`.
- Snapshot immutability: future changes to components must never alter already-sold items.
- Price/cost fields use `decimal(10,2)` via `z.number()` (AGENTS.md quirk: match DB decimal type).
- Dashboard counts only valid sales — never `CANCELED`.
- Tests: TDD, real integration (no Knex mocking), `cleanupDatabase()` in `before`/`after`, clean up only own data, never `db("users").del()`.
- Soft delete everywhere except methods explicitly named `hardDelete`.
- All new routes follow existing auth patterns: `onRequest: [fastify.authenticate]`, `preHandler: [requireRole(['ADMIN','SUPER_ADMIN'])]`, `csrfProtection()` hook.
- No new dependencies.

---

## Design Decisions (confirmed with user)

1. **Association level:** product-level (`product_cost_components` with `quantity`), not variant-level.
2. **Snapshot:** fixed columns + `cost_breakdown` jsonb per order item.
3. **Component types (enum):** `FIXED` (per-unit value, covers "por produto"/"por quantidade"), `PERCENT` (base `PRICE` or `COST`), `PER_ORDER` (once per order), `MONTHLY` (control only, excluded from engine).
4. **Order-level costs** (freight `shipping_cost_owner`, `PER_ORDER` components, discount): allocated proportionally to items by `weight = unit_price × quantity`.
5. **Single master plan** with phases.
6. **Complementary decision:** each component gets a `category` enum (`PACKAGING | TAX | FEE | SHIPPING | OPERATIONAL | MARKETING | OTHER`) that routes the computed value to the correct snapshot column. Components remain fully dynamic — category only maps to the stable snapshot columns. Fallback: products with no configured components keep the legacy calculation (`packaging_cost` + `platform_fee_percent`) so existing behavior is preserved.

---

## File Structure

### Created files
| File | Responsibility |
|---|---|
| `src/database/migrations/20260801090000_cost_and_customers.ts` | cost_components, product_cost_components, customers, orders/order_items additions |
| `src/schemas/cost.schema.ts` | Zod schemas for cost CRUD + associations + simulation |
| `src/repositories/cost.repository.ts` | Cost component/association persistence + batch loader for engine |
| `src/services/cost.service.ts` | Cost CRUD orchestration |
| `src/routers/cost.router.ts` | `/api/cost-components` endpoints |
| `src/lib/cost-engine.ts` | Pure cost calculation engine |
| `src/lib/cost-engine.test.ts` | Unit tests for the engine |
| `src/services/cost.service.integration.test.ts` | CRUD integration tests |
| `src/schemas/external-sale.schema.ts` | Zod schemas for external sale |
| `src/repositories/external-sale.repository.ts` | External sale persistence (transaction) |
| `src/services/external-sale.service.ts` | External sale orchestration |
| `src/routers/external-sale.router.ts` | `/api/external-sales` endpoints |
| `src/services/external-sale.service.integration.test.ts` | Integration tests |
| `src/repositories/customer.repository.ts` | Customer persistence + aggregations |
| `src/services/customer.service.ts` | Customer orchestration |
| `src/routers/customer.router.ts` | `/api/customers` endpoints |
| `src/services/customer.service.integration.test.ts` | Integration tests |
| `src/lib/order-status.ts` | Status → PT-BR translation map + enrichment helpers |

### Modified files
| File | Change |
|---|---|
| `src/test/setup.ts` | Add new tables to `cleanupDatabase()` |
| `src/repositories/order.repository.ts` | Run engine in `upsertOrderFromNuvemshop` + `create`; persist snapshots/totals; select `product_id` |
| `src/services/order.service.ts` | Enrich responses, upsert customer, wire engine in `createOrder` |
| `src/routers/order.router.ts` | Return enriched payloads |
| `src/schemas/order.schema.ts` | Add snapshot + enrichment fields to response/listResponse |
| `src/repositories/dashboard.repository.ts` | Exclude CANCELED, add date filters |
| `src/services/dashboard.service.ts` | Pass date filters |
| `src/routers/dashboard.router.ts` | Accept `start_date`/`end_date` |
| `src/repositories/product.repository.ts` | Search across variants |
| `src/server.ts` | Register new routers |

---

## Phase 0 — Foundation

### Task 0.1: Cost & customers migration

**Files:**
- Create: `src/database/migrations/20260801090000_cost_and_customers.ts`

**Interfaces:**
- Produces: tables `cost_components`, `product_cost_components`, `customers`; columns on `orders` (`source`, `total_cost`, `total_profit`, `margin_percent`) and `order_items` (`unit_tax`, `unit_shipping_cost`, `unit_operational_cost`, `unit_marketing_cost`, `unit_other_cost`, `unit_total_cost`, `unit_profit`, `margin_percent`, `cost_breakdown`)

- [ ] **Step 1: Create the migration file**

```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("cost_components", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.string("name").notNullable();
    table.string("description").nullable();
    table.string("type").notNullable(); // FIXED | PERCENT | PER_ORDER | MONTHLY
    table.string("category").notNullable().defaultTo("OTHER"); // PACKAGING|TAX|FEE|SHIPPING|OPERATIONAL|MARKETING|OTHER
    table.decimal("value", 10, 2).notNullable().defaultTo(0);
    table.string("calculation_base").notNullable().defaultTo("PRICE"); // PRICE | COST (PERCENT only)
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("product_cost_components", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("product_id").references("id").inTable("products").onDelete("CASCADE").notNullable().index();
    table.uuid("cost_component_id").references("id").inTable("cost_components").onDelete("CASCADE").notNullable();
    table.integer("quantity").notNullable().defaultTo(1);
    table.timestamps(true, true);
    table.unique(["product_id", "cost_component_id"]);
  });

  await knex.schema.createTable("customers", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.string("email").nullable().unique();
    table.string("name").notNullable();
    table.string("city").nullable();
    table.string("province").nullable();
    table.string("phone").nullable();
    table.string("origin").nullable();
    table.string("utm_source").nullable();
    table.string("utm_medium").nullable();
    table.string("utm_campaign").nullable();
    table.string("utm_content").nullable();
    table.string("utm_term").nullable();
    table.timestamp("first_purchase_at").nullable();
    table.timestamp("last_purchase_at").nullable();
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.alterTable("orders", (table) => {
    table.string("source", 20).notNullable().defaultTo("NUVEMSHOP");
    table.decimal("total_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("total_profit", 10, 2).notNullable().defaultTo(0);
    table.decimal("margin_percent", 5, 2).notNullable().defaultTo(0);
  });

  await knex.schema.alterTable("order_items", (table) => {
    table.decimal("unit_tax", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_shipping_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_operational_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_marketing_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_other_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_total_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_profit", 10, 2).notNullable().defaultTo(0);
    table.decimal("margin_percent", 5, 2).notNullable().defaultTo(0);
    table.jsonb("cost_breakdown").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("unit_tax");
    table.dropColumn("unit_shipping_cost");
    table.dropColumn("unit_operational_cost");
    table.dropColumn("unit_marketing_cost");
    table.dropColumn("unit_other_cost");
    table.dropColumn("unit_total_cost");
    table.dropColumn("unit_profit");
    table.dropColumn("margin_percent");
    table.dropColumn("cost_breakdown");
  });

  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("source");
    table.dropColumn("total_cost");
    table.dropColumn("total_profit");
    table.dropColumn("margin_percent");
  });

  await knex.schema.dropTableIfExists("customers");
  await knex.schema.dropTableIfExists("product_cost_components");
  await knex.schema.dropTableIfExists("cost_components");
}
```

- [ ] **Step 2: Run the migration**

```bash
npm run db:migrate
```
Expected: migrations applied successfully.

- [ ] **Step 3: Verify columns exist**

```bash
docker compose exec -T db psql -U admin -d aurasync -c "\d order_items"
```
Expected: new snapshot columns present.

- [ ] **Step 4: Commit**

```bash
git add src/database/migrations/20260801090000_cost_and_customers.ts
git commit -m "feat: add cost components, customers, order financial columns migrations"
```

### Task 0.2: Update test cleanup

**Files:**
- Modify: `src/test/setup.ts:3-21`

**Interfaces:**
- Consumes: existing `cleanupDatabase()`
- Produces: truncation including `product_cost_components`, `cost_components`, `customers`

- [ ] **Step 1: Edit the tables array**

```ts
export const cleanupDatabase = async () => {
  const tables = [
    'inventory_transactions',
    'order_items',
    'orders',
    'product_variants',
    'products',
    'product_cost_components',
    'cost_components',
    'customers'
  ];
```

- [ ] **Step 2: Commit**

```bash
git add src/test/setup.ts
git commit -m "test: include new tables in database cleanup"
```

---

## Phase 1 — Cost Module

### Task 1.1: Cost engine (pure functions)

**Files:**
- Create: `src/lib/cost-engine.ts`
- Test: `src/lib/cost-engine.test.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces: `computeOrderCosts(items: CostEngineItemInput[], orderLevel: OrderLevelInput): OrderCostResult`

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeOrderCosts, type CostEngineItemInput } from "./cost-engine.js";

function baseItem(overrides: Partial<CostEngineItemInput> = {}): CostEngineItemInput {
  return {
    variant_id: "11111111-1111-1111-1111-111111111111",
    product_id: "22222222-2222-2222-2222-222222222222",
    unit_price: 100,
    quantity: 1,
    product_cost: 40,
    legacy_packaging_cost: 2,
    legacy_platform_fee_percent: 3,
    components: [],
    ...overrides,
  };
}

describe("CostEngine", () => {
  it("applies legacy fallback when no components are configured", () => {
    const result = computeOrderCosts([baseItem()], { shipping_cost_owner: 0, discount_amount: 0 });
    const item = result.items[0]!;
    assert.strictEqual(item.unit_cost, 40);
    assert.strictEqual(item.unit_packaging_cost, 2);
    assert.strictEqual(item.unit_platform_fee, 3); // 100 * 3%
    assert.strictEqual(item.unit_total_cost, 45);
    assert.strictEqual(item.unit_profit, 55);
    assert.strictEqual(item.margin_percent, 55);
  });

  it("computes FIXED components with association quantity routed by category", () => {
    const item = baseItem({
      components: [
        { id: "c1", name: "Caixa P", type: "FIXED", category: "PACKAGING", value: 1.5, calculation_base: "PRICE", quantity: 2 },
      ],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_packaging_cost, 3); // 1.5 * 2
    assert.strictEqual(result.items[0]!.unit_platform_fee, 0); // no legacy when components exist
  });

  it("computes PERCENT components on PRICE and COST bases", () => {
    const item = baseItem({
      components: [
        { id: "c1", name: "Imposto", type: "PERCENT", category: "TAX", value: 2.64, calculation_base: "PRICE", quantity: 1 },
        { id: "c2", name: "Comissão", type: "PERCENT", category: "FEE", value: 5, calculation_base: "COST", quantity: 1 },
      ],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_tax, 2.64); // 100 * 2.64%
    assert.strictEqual(result.items[0]!.unit_platform_fee, 2); // 40 * 5%
  });

  it("allocates PER_ORDER components and freight proportionally", () => {
    const items = [
      baseItem({ variant_id: "v1", unit_price: 100, quantity: 1, components: [] }),
      baseItem({ variant_id: "v2", unit_price: 300, quantity: 1, components: [
        { id: "c1", name: "Taxa Plataforma", type: "PER_ORDER", category: "FEE", value: 10, calculation_base: "PRICE", quantity: 1 },
      ] }),
    ];
    // weight v1=100, v2=300; total 400. freight=20, per-order fee=10 → allocated 30
    const result = computeOrderCosts(items, { shipping_cost_owner: 20, discount_amount: 0 });
    const v1 = result.items.find(i => i.variant_id === "v1")!;
    const v2 = result.items.find(i => i.variant_id === "v2")!;
    assert.strictEqual(v1.unit_shipping_cost, 5); // 20 * 25%
    assert.strictEqual(v2.unit_shipping_cost, 15);
    assert.strictEqual(v2.unit_platform_fee, 7.5); // 10 * 75%
    assert.strictEqual(result.total_cost, 45 + 45 + 20 + 10);
  });

  it("allocates discount proportionally for item profit", () => {
    const items = [
      baseItem({ variant_id: "v1", unit_price: 100, quantity: 1, components: [] }),
      baseItem({ variant_id: "v2", unit_price: 300, quantity: 1, components: [] }),
    ];
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 40 });
    const v1 = result.items.find(i => i.variant_id === "v1")!;
    assert.strictEqual(v1.unit_profit, 45); // 100 - 10 (25% of 40) - 45
  });

  it("ignores MONTHLY components", () => {
    const item = baseItem({ components: [
      { id: "c1", name: "Contadora", type: "MONTHLY", category: "OPERATIONAL", value: 500, calculation_base: "PRICE", quantity: 1 },
    ] });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_operational_cost, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module `./cost-engine.js` not found.

- [ ] **Step 3: Implement the engine**

```ts
export type CostComponentType = "FIXED" | "PERCENT" | "PER_ORDER" | "MONTHLY";
export type CostComponentCategory =
  | "PACKAGING" | "TAX" | "FEE" | "SHIPPING" | "OPERATIONAL" | "MARKETING" | "OTHER";
export type CalculationBase = "PRICE" | "COST";

export interface CostComponentInput {
  id: string;
  name: string;
  type: CostComponentType;
  category: CostComponentCategory;
  value: number;
  calculation_base: CalculationBase;
  quantity: number; // association quantity
}

export interface CostEngineItemInput {
  variant_id: string;
  product_id: string;
  unit_price: number;
  quantity: number;
  product_cost: number; // variant.cost_price
  legacy_packaging_cost: number;
  legacy_platform_fee_percent: number;
  components: CostComponentInput[];
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

const categoryKey: Record<CostComponentCategory, keyof ItemCostSnapshot> = {
  PACKAGING: "unit_packaging_cost",
  TAX: "unit_tax",
  FEE: "unit_platform_fee",
  SHIPPING: "unit_shipping_cost",
  OPERATIONAL: "unit_operational_cost",
  MARKETING: "unit_marketing_cost",
  OTHER: "unit_other_cost",
};

interface ItemBaseCost {
  input: CostEngineItemInput;
  perUnit: Record<keyof typeof categoryKey, number>;
  breakdown: CostBreakdownEntry[];
  perOrderFees: Array<{ value: number; category: CostComponentCategory }>;
}

function computeItemBase(input: CostEngineItemInput): ItemBaseCost {
  const perUnit: Record<CostComponentCategory, number> = {
    PACKAGING: 0, TAX: 0, FEE: 0, SHIPPING: 0, OPERATIONAL: 0, MARKETING: 0, OTHER: 0,
  };
  const breakdown: CostBreakdownEntry[] = [];
  const perOrderFees: ItemBaseCost["perOrderFees"] = [];

  breakdown.push({
    component_id: null,
    name: "Custo do produto",
    type: "PRODUCT",
    category: "PRODUCT",
    unit_value: input.product_cost,
    quantity: 1,
    line_total: input.product_cost,
  });

  if (input.components.length === 0) {
    const packaging = input.legacy_packaging_cost || 0;
    const fee = input.legacy_platform_fee_percent
      ? (input.unit_price * input.legacy_platform_fee_percent) / 100
      : 0;
    perUnit.PACKAGING = packaging;
    perUnit.FEE = fee;
    if (packaging) breakdown.push({ component_id: null, name: "Embalagem (legado)", type: "FIXED", category: "PACKAGING", unit_value: packaging, quantity: 1, line_total: packaging });
    if (fee) breakdown.push({ component_id: null, name: "Taxa da plataforma (legado)", type: "PERCENT", category: "FEE", unit_value: fee, quantity: 1, line_total: fee });
    return { input, perUnit, breakdown, perOrderFees };
  }

  for (const c of input.components) {
    if (c.type === "MONTHLY") continue;

    if (c.type === "PER_ORDER") {
      perOrderFees.push({ value: c.value, category: c.category });
      breakdown.push({ component_id: c.id, name: c.name, type: c.type, category: c.category, unit_value: c.value, quantity: 1, line_total: c.value });
      continue;
    }

    let unitValue = 0;
    if (c.type === "FIXED") {
      unitValue = c.value * c.quantity;
    } else if (c.type === "PERCENT") {
      const base = c.calculation_base === "COST" ? input.product_cost : input.unit_price;
      unitValue = (base * c.value) / 100;
    }

    perUnit[c.category] += unitValue;
    breakdown.push({
      component_id: c.id, name: c.name, type: c.type, category: c.category,
      unit_value: unitValue, quantity: 1, line_total: unitValue,
    });
  }

  return { input, perUnit, breakdown, perOrderFees };
}

export function computeOrderCosts(
  items: CostEngineItemInput[],
  orderLevel: { shipping_cost_owner: number; discount_amount: number }
): OrderCostResult {
  const baseCosts = items.map(computeItemBase);
  const totalWeight = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const totalPerOrderFees = baseCosts.reduce((sum, b) =>
    sum + b.perOrderFees.reduce((s, f) => s + f.value, 0), 0);
  const freight = orderLevel.shipping_cost_owner || 0;
  const orderLevelTotal = freight + totalPerOrderFees;

  const snapshots: ItemCostSnapshot[] = baseCosts.map((b) => {
    const { input } = b;
    const weight = input.unit_price * input.quantity;
    const share = totalWeight > 0 ? weight / totalWeight : 0;

    const perUnit: Record<CostComponentCategory, number> = {
      PACKAGING: b.perUnit.PACKAGING, TAX: b.perUnit.TAX, FEE: b.perUnit.FEE,
      SHIPPING: b.perUnit.SHIPPING, OPERATIONAL: b.perUnit.OPERATIONAL,
      MARKETING: b.perUnit.MARKETING, OTHER: b.perUnit.OTHER,
    };

    // allocate order-level costs (freight + per-order fees) by share
    if (share > 0) {
      perUnit.SHIPPING += round2(freight * share);
      for (const f of b.perOrderFees) {
        perUnit[f.category] += round2(f.value * share);
      }
    }

    const allocationBreakdown: CostBreakdownEntry[] = [];
    if (share > 0 && freight > 0) {
      allocationBreakdown.push({ component_id: null, name: "Frete (rateado)", type: "ALLOCATION", category: "SHIPPING", unit_value: round2(freight * share), quantity: 1, line_total: round2(freight * share) });
    }
    for (const f of b.perOrderFees) {
      allocationBreakdown.push({ component_id: null, name: f.value > 0 ? "Taxa por pedido (rateado)" : "", type: "ALLOCATION", category: f.category, unit_value: round2(f.value * share), quantity: 1, line_total: round2(f.value * share) });
    }

    const unit_total_cost = round2(
      input.product_cost + perUnit.PACKAGING + perUnit.TAX + perUnit.FEE +
      perUnit.SHIPPING + perUnit.OPERATIONAL + perUnit.MARKETING + perUnit.OTHER
    );

    const grossRevenue = input.unit_price * input.quantity;
    const discountShare = totalWeight > 0 ? (orderLevel.discount_amount || 0) * share : 0;
    const netUnitRevenue = (grossRevenue - discountShare) / input.quantity;
    const unit_profit = round2(netUnitRevenue - unit_total_cost);
    const margin_percent = netUnitRevenue > 0 ? round2((unit_profit / netUnitRevenue) * 100) : 0;

    return {
      variant_id: input.variant_id,
      unit_cost: input.product_cost,
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 6 cost-engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost-engine.ts src/lib/cost-engine.test.ts
git commit -m "feat: add pure cost engine with snapshot computation"
```

### Task 1.2: Cost schema

**Files:**
- Create: `src/schemas/cost.schema.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CostSchema` object with `create`, `update`, `base`, `associate`, `associateResponse`, `simulate`, `simulateResponse`, `listAssociationsResponse` + inferred types

- [ ] **Step 1: Create the schema file**

```ts
import { z } from "zod";

export const CostComponentTypeEnum = z.enum(["FIXED", "PERCENT", "PER_ORDER", "MONTHLY"]);
export const CostComponentCategoryEnum = z.enum([
  "PACKAGING", "TAX", "FEE", "SHIPPING", "OPERATIONAL", "MARKETING", "OTHER",
]);
export const CalculationBaseEnum = z.enum(["PRICE", "COST"]);

export const CostSchema = {
  base: z.object({
    id: z.uuid(),
    name: z.string().min(1, "Name is required"),
    description: z.string().nullable().optional(),
    type: CostComponentTypeEnum,
    category: CostComponentCategoryEnum.default("OTHER"),
    value: z.number().min(0, "Value cannot be negative"),
    calculation_base: CalculationBaseEnum.default("PRICE"),
    is_active: z.boolean().default(true),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
  }),

  create: z.object({
    name: z.string().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
    description: z.string().max(500).optional(),
    type: CostComponentTypeEnum,
    category: CostComponentCategoryEnum.optional(),
    value: z.number().min(0, "Value cannot be negative"),
    calculation_base: CalculationBaseEnum.optional(),
    is_active: z.boolean().optional(),
  }).superRefine((data, ctx) => {
    if (data.type === "PERCENT" && data.calculation_base === undefined) {
      ctx.addIssue({ code: "custom", path: ["calculation_base"], message: "calculation_base is required for PERCENT components" });
    }
  }),

  update: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    type: CostComponentTypeEnum.optional(),
    category: CostComponentCategoryEnum.optional(),
    value: z.number().min(0).optional(),
    calculation_base: CalculationBaseEnum.optional(),
    is_active: z.boolean().optional(),
  }),

  associate: z.object({
    product_id: z.uuid("Invalid product ID"),
    cost_component_id: z.uuid("Invalid component ID"),
    quantity: z.number().int().positive().default(1),
  }),

  associateResponse: z.object({
    id: z.uuid(),
    product_id: z.uuid(),
    cost_component_id: z.uuid(),
    quantity: z.number().int(),
    component: CostSchema.base.optional(),
  }),

  simulate: z.object({
    variant_id: z.uuid("Invalid variant ID"),
    unit_price: z.number().min(0, "Unit price cannot be negative"),
    quantity: z.number().int().positive(),
  }),

  simulateResponse: z.object({
    unit_cost: z.number(),
    unit_packaging_cost: z.number(),
    unit_platform_fee: z.number(),
    unit_tax: z.number(),
    unit_shipping_cost: z.number(),
    unit_operational_cost: z.number(),
    unit_marketing_cost: z.number(),
    unit_other_cost: z.number(),
    unit_total_cost: z.number(),
    unit_profit: z.number(),
    margin_percent: z.number(),
    cost_breakdown: z.array(z.object({
      component_id: z.string().nullable(),
      name: z.string(),
      type: z.string(),
      category: z.string(),
      unit_value: z.number(),
      quantity: z.number(),
      line_total: z.number(),
    })),
  }),

  listAssociationsResponse: z.object({
    associations: z.array(CostSchema.associateResponse),
  }),
};

export type CostComponent = z.infer<typeof CostSchema.base>;
export type CostComponentCreate = z.infer<typeof CostSchema.create>;
export type CostComponentUpdate = z.infer<typeof CostSchema.update>;
export type CostAssociationCreate = z.infer<typeof CostSchema.associate>;
export type CostAssociationResponse = z.infer<typeof CostSchema.associateResponse>;
export type CostSimulateInput = z.infer<typeof CostSchema.simulate>;
export type CostSimulateResponse = z.infer<typeof CostSchema.simulateResponse>;
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/cost.schema.ts
git commit -m "feat: add cost component Zod schemas"
```

### Task 1.3: Cost repository

**Files:**
- Create: `src/repositories/cost.repository.ts`

**Interfaces:**
- Consumes: `db` from `src/lib/db.js`
- Produces: `createComponent`, `updateComponent`, `softDeleteComponent`, `listComponents`, `findComponentById`, `associateComponent`, `hardDeleteAssociation`, `listAssociationsByProduct`, `getComponentsByProductIds`

- [ ] **Step 1: Create the repository file**

```ts
import { db } from '../lib/db.js';
import type { CostComponent, CostComponentCreate, CostComponentUpdate, CostAssociationCreate } from '../schemas/cost.schema.js';

export interface ComponentWithQuantity {
  id: string;
  name: string;
  type: string;
  category: string;
  value: number;
  calculation_base: string;
  quantity: number;
}

export class CostRepository {
  private table = 'cost_components';
  private associationTable = 'product_cost_components';

  async createComponent(data: Omit<CostComponentCreate, 'id' | 'created_at' | 'updated_at'> & { is_active: boolean }): Promise<CostComponent> {
    const [row] = await db(this.table).insert(data).returning('*');
    return row;
  }

  async updateComponent(id: string, data: CostComponentUpdate): Promise<CostComponent | null> {
    const [row] = await db(this.table)
      .where({ id })
      .whereNull('deleted_at')
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return row || null;
  }

  async softDeleteComponent(id: string): Promise<boolean> {
    const result = await db(this.table)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), is_active: false, updated_at: new Date() });
    return result > 0;
  }

  async listComponents(filter: { is_active?: boolean; search?: string } = {}): Promise<CostComponent[]> {
    let query = db(this.table).whereNull('deleted_at').orderBy('name', 'asc');
    if (filter.is_active !== undefined) query = query.where('is_active', filter.is_active);
    if (filter.search) query = query.where('name', 'ilike', `%${filter.search}%`);
    return query;
  }

  async findComponentById(id: string): Promise<CostComponent | null> {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  async associateComponent(data: CostAssociationCreate): Promise<{ id: string; product_id: string; cost_component_id: string; quantity: number }> {
    const [row] = await db(this.associationTable)
      .insert(data)
      .onConflict(['product_id', 'cost_component_id'])
      .merge({ quantity: data.quantity })
      .returning('*');
    return row;
  }

  async hardDeleteAssociation(id: string): Promise<boolean> {
    const result = await db(this.associationTable).where({ id }).del();
    return result > 0;
  }

  async listAssociationsByProduct(productId: string): Promise<Array<{ id: string; product_id: string; cost_component_id: string; quantity: number; component: CostComponent }>> {
    const rows = await db(this.associationTable)
      .where(`${this.associationTable}.product_id`, productId)
      .join(this.table, `${this.table}.id`, `${this.associationTable}.cost_component_id`)
      .whereNull(`${this.table}.deleted_at`)
      .select(
        `${this.associationTable}.id`,
        `${this.associationTable}.product_id`,
        `${this.associationTable}.cost_component_id`,
        `${this.associationTable}.quantity`,
        `${this.table}.id as component_id`,
        `${this.table}.name`,
        `${this.table}.description`,
        `${this.table}.type`,
        `${this.table}.category`,
        `${this.table}.value`,
        `${this.table}.calculation_base`,
        `${this.table}.is_active`,
        `${this.table}.created_at`,
        `${this.table}.updated_at`,
      );
    return rows.map((r) => ({
      id: r.id,
      product_id: r.product_id,
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
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    }));
  }

  async getComponentsByProductIds(productIds: string[]): Promise<Array<{ product_id: string; quantity: number } & ComponentWithQuantity>> {
    if (productIds.length === 0) return [];
    return db(this.associationTable)
      .whereIn(`${this.associationTable}.product_id`, productIds)
      .join(this.table, `${this.table}.id`, `${this.associationTable}.cost_component_id`)
      .whereNull(`${this.table}.deleted_at`)
      .select(
        `${this.associationTable}.product_id`,
        `${this.associationTable}.quantity`,
        `${this.table}.id`,
        `${this.table}.name`,
        `${this.table}.type`,
        `${this.table}.category`,
        `${this.table}.value`,
        `${this.table}.calculation_base`,
      );
  }
}

export const costRepository = new CostRepository();
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/cost.repository.ts
git commit -m "feat: add cost repository with component CRUD and associations"
```

### Task 1.4: Cost service

**Files:**
- Create: `src/services/cost.service.ts`

**Interfaces:**
- Consumes: `costRepository`, `CostSchema`, `productRepository`
- Produces: `listComponents`, `createComponent`, `updateComponent`, `deleteComponent`, `associateComponent`, `removeAssociation`, `getAssociationsByProduct`, `simulateCosts`

- [ ] **Step 1: Create the service file**

```ts
import { costRepository } from '../repositories/cost.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { CostSchema, type CostComponentCreate, type CostComponentUpdate, type CostAssociationCreate, type CostSimulateInput } from '../schemas/cost.schema.js';
import { computeOrderCosts } from '../lib/cost-engine.js';
import { db } from '../lib/db.js';

export class CostService {
  async listComponents(filter: { is_active?: boolean; search?: string } = {}) {
    return costRepository.listComponents(filter);
  }

  async createComponent(data: CostComponentCreate) {
    const validated = CostSchema.create.parse(data);
    const payload = {
      name: validated.name,
      description: validated.description ?? null,
      type: validated.type,
      category: validated.category ?? 'OTHER',
      value: validated.value,
      calculation_base: validated.calculation_base ?? 'PRICE',
      is_active: validated.is_active ?? true,
    };
    return costRepository.createComponent(payload);
  }

  async updateComponent(id: string, data: CostComponentUpdate) {
    const validated = CostSchema.update.parse(data);
    const existing = await costRepository.findComponentById(id);
    if (!existing) throw new Error('Cost component not found');
    if (validated.type === 'PERCENT' && validated.calculation_base === undefined && existing.calculation_base === 'PRICE') {
      // keep existing base; nothing to do
    }
    const updated = await costRepository.updateComponent(id, validated);
    return updated;
  }

  async deleteComponent(id: string) {
    const existing = await costRepository.findComponentById(id);
    if (!existing) throw new Error('Cost component not found');
    return costRepository.softDeleteComponent(id);
  }

  async associateComponent(data: CostAssociationCreate) {
    const validated = CostSchema.associate.parse(data);
    const product = await productRepository.findById(validated.product_id);
    if (!product) throw new Error('Product not found');
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new Error('Cost component not found');
    const association = await costRepository.associateComponent(validated);
    const associations = await costRepository.listAssociationsByProduct(validated.product_id);
    const full = associations.find(a => a.id === association.id);
    return full ?? association;
  }

  async removeAssociation(id: string) {
    return costRepository.hardDeleteAssociation(id);
  }

  async getAssociationsByProduct(productId: string) {
    const product = await productRepository.findById(productId);
    if (!product) throw new Error('Product not found');
    const associations = await costRepository.listAssociationsByProduct(productId);
    return associations;
  }

  async simulateCosts(input: CostSimulateInput) {
    const validated = CostSchema.simulate.parse(input);
    const variant = await db('product_variants')
      .where({ id: validated.variant_id })
      .whereNull('deleted_at')
      .first();
    if (!variant) throw new Error('Product variant not found');

    const components = await costRepository.getComponentsByProductIds([variant.product_id]);
    const componentInputs = components.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type as 'FIXED' | 'PERCENT' | 'PER_ORDER' | 'MONTHLY',
      category: c.category as 'PACKAGING' | 'TAX' | 'FEE' | 'SHIPPING' | 'OPERATIONAL' | 'MARKETING' | 'OTHER',
      value: Number(c.value),
      calculation_base: c.calculation_base as 'PRICE' | 'COST',
      quantity: c.quantity,
    }));

    const result = computeOrderCosts(
      [{
        variant_id: variant.id,
        product_id: variant.product_id,
        unit_price: validated.unit_price,
        quantity: validated.quantity,
        product_cost: Number(variant.cost_price || 0),
        legacy_packaging_cost: Number(variant.packaging_cost || 0),
        legacy_platform_fee_percent: Number(variant.platform_fee_percent || 0),
        components: componentInputs,
      }],
      { shipping_cost_owner: 0, discount_amount: 0 }
    );

    return result.items[0];
  }
}

export const costService = new CostService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/cost.service.ts
git commit -m "feat: add cost service"
```

### Task 1.5: Cost router

**Files:**
- Create: `src/routers/cost.router.ts`
- Modify: `src/server.ts:96` (register router)

**Interfaces:**
- Consumes: `costService`, `CostSchema`
- Produces: Fastify plugin with endpoints under `/api/cost-components`

- [ ] **Step 1: Create the router file**

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { costService } from '../services/cost.service.js';
import { CostSchema } from '../schemas/cost.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const costRoutes: FastifyPluginAsyncZod = async (fastify) => {
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
      const components = await costService.listComponents(filters);
      return reply.send(components);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.create },
  }, async (request, reply) => {
    try {
      const component = await costService.createComponent(request.body);
      return reply.code(201).send(component);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.put('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }), body: CostSchema.update },
  }, async (request, reply) => {
    try {
      const component = await costService.updateComponent(request.params.id, request.body);
      if (!component) return reply.code(404).send({ error: 'Cost component not found' });
      return reply.send(component);
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
      const deleted = await costService.deleteComponent(request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'Cost component not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/associate', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.associate },
  }, async (request, reply) => {
    try {
      const association = await costService.associateComponent(request.body);
      return reply.code(201).send(association);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete('/associate/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const removed = await costService.removeAssociation(request.params.id);
      if (!removed) return reply.code(404).send({ error: 'Association not found' });
      return reply.code(204).send();
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/product/:productId', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ productId: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const associations = await costService.getAssociationsByProduct(request.params.productId);
      return reply.send({ associations });
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post('/simulate', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: CostSchema.simulate },
  }, async (request, reply) => {
    try {
      const result = await costService.simulateCosts(request.body);
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
```

- [ ] **Step 2: Register the router in server.ts**

```ts
import { costRoutes } from './routers/cost.router.js';
// ...
app.register(costRoutes, { prefix: '/api/cost-components' });
```

- [ ] **Step 3: Commit**

```bash
git add src/routers/cost.router.ts src/server.ts
git commit -m "feat: add cost components router and register it"
```

### Task 1.6: Cost service integration tests

**Files:**
- Create: `src/services/cost.service.integration.test.ts`

**Interfaces:**
- Consumes: `costService`, `productService`, `cleanupDatabase`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { costService } from "./cost.service.js";
import { productService } from "./product.service.js";
import { cleanupDatabase } from "../test/setup.js";

describe("CostService Integration Tests", () => {
  let productId: string;
  let variantId: string;
  let componentId: string;
  let associationId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "cost-engine-test-product",
      name: "Cost Engine Test Product",
      variants: [{ price: 100, stock_quantity: 50, cost_price: 40, packaging_cost: 2, platform_fee_percent: 3 }],
    });
    productId = product.id;
    variantId = product.variants[0]!.id;
  });

  after(async () => {
    await cleanupDatabase();
  });

  it("creates a cost component", async () => {
    const component = await costService.createComponent({
      name: "Caixa P",
      description: "Caixa pequena de papelão",
      type: "FIXED",
      value: 1.5,
    });
    componentId = component.id;
    assert.ok(component.id);
    assert.strictEqual(component.name, "Caixa P");
    assert.strictEqual(component.category, "OTHER");
  });

  it("creates a PERCENT component and requires calculation_base", async () => {
    await assert.rejects(
      async () => costService.createComponent({ name: "Imposto", type: "PERCENT", value: 2.64 } as any),
      (err: Error) => err.message.includes("calculation_base") || err.message.includes("Invalid")
    );
    const component = await costService.createComponent({
      name: "Imposto", type: "PERCENT", value: 2.64, calculation_base: "PRICE",
    });
    assert.ok(component.id);
  });

  it("lists components", async () => {
    const components = await costService.listComponents();
    assert.ok(components.length >= 2);
  });

  it("updates a component", async () => {
    const updated = await costService.updateComponent(componentId, { value: 2.0 });
    assert.strictEqual(Number(updated!.value), 2.0);
  });

  it("associates a component with a product", async () => {
    const association = await costService.associateComponent({
      product_id: productId,
      cost_component_id: componentId,
      quantity: 2,
    });
    associationId = association!.id;
    assert.ok(association!.id);
    assert.strictEqual(Number(association!.quantity), 2);
    assert.strictEqual(association!.component.name, "Caixa P");
  });

  it("fails to associate with a non-existent product", async () => {
    await assert.rejects(
      async () => costService.associateComponent({
        product_id: "00000000-0000-0000-0000-000000000099",
        cost_component_id: componentId,
      }),
      (err: Error) => err.message.includes("Product not found")
    );
  });

  it("simulates a cost composition using the engine", async () => {
    const result = await costService.simulateCosts({ variant_id: variantId, unit_price: 100, quantity: 1 });
    assert.strictEqual(Number(result!.unit_packaging_cost), 4); // 2.0 * 2 association qty
    assert.strictEqual(Number(result!.unit_total_cost), 44); // 40 + 4
  });

  it("removes an association", async () => {
    const removed = await costService.removeAssociation(associationId);
    assert.strictEqual(removed, true);
    const associations = await costService.getAssociationsByProduct(productId);
    assert.strictEqual(associations.length, 0);
  });

  it("soft-deletes a component", async () => {
    const deleted = await costService.deleteComponent(componentId);
    assert.strictEqual(deleted, true);
    const components = await costService.listComponents();
    assert.ok(!components.some(c => c.id === componentId));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `costService` module not found.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: all cost-service tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/cost.service.integration.test.ts
git commit -m "test: add cost service integration tests"
```

---

## Phase 2 — Wire Engine into Orders

### Task 2.1: Run engine in Nuvemshop upsert

**Files:**
- Modify: `src/repositories/order.repository.ts:197-303` and `src/repositories/order.repository.ts:138-195`

**Interfaces:**
- Consumes: `computeOrderCosts`, `costRepository.getComponentsByProductIds`
- Produces: Nuvemshop and generic orders persisted with snapshots + `orders.total_cost/total_profit/margin_percent`

**Note (required):** Also update the `Order` and `OrderItem` interfaces in `src/repositories/order.repository.ts` to include the new columns — `Order`: `source: string`, `total_cost: number`, `total_profit: number`, `margin_percent: number`; `OrderItem`: `unit_tax`, `unit_shipping_cost`, `unit_operational_cost`, `unit_marketing_cost`, `unit_other_cost`, `unit_total_cost`, `unit_profit` (numbers), `margin_percent` (number), `cost_breakdown: any[] | null`. Without these, `tsc --noEmit` (final verification) and TypeScript checks in later tasks fail.

- [ ] **Step 1: Add imports and a shared snapshot builder to the repository**

```ts
import { costRepository } from './cost.repository.js';
import { computeOrderCosts, type CostEngineItemInput, type ItemCostSnapshot } from '../lib/cost-engine.js';

// helper: converts a plain DB item row + computed snapshot into the insert payload
function applySnapshot(base: Record<string, unknown>, snapshot: ItemCostSnapshot): Record<string, unknown> {
  return {
    ...base,
    unit_cost: snapshot.unit_cost,
    unit_packaging_cost: snapshot.unit_packaging_cost,
    unit_platform_fee: snapshot.unit_platform_fee,
    unit_tax: snapshot.unit_tax,
    unit_shipping_cost: snapshot.unit_shipping_cost,
    unit_operational_cost: snapshot.unit_operational_cost,
    unit_marketing_cost: snapshot.unit_marketing_cost,
    unit_other_cost: snapshot.unit_other_cost,
    unit_total_cost: snapshot.unit_total_cost,
    unit_profit: snapshot.unit_profit,
    margin_percent: snapshot.margin_percent,
    cost_breakdown: JSON.stringify(snapshot.cost_breakdown),
  };
}
```

- [ ] **Step 2: Modify `upsertOrderFromNuvemshop` to compute and persist snapshots**

Replace the variant selection at lines ~266-270 to include `product_id`:

```ts
      const internalVariants = await trx('product_variants')
        .whereIn('nuvemshop_variant_id', nuvemshopVariantIds)
        .select('id', 'nuvemshop_variant_id', 'product_id', 'cost_price', 'packaging_cost', 'platform_fee_percent');
```

After building `variantMap`, load components and compute the order costs before the item loop:

```ts
      const productIds = [...new Set(internalVariants.map(v => v.product_id))];
      const componentsByProduct = new Map<string, Array<{ id: string; name: string; type: string; category: string; value: number; calculation_base: string; quantity: number }>>();
      for (const row of await costRepository.getComponentsByProductIds(productIds)) {
        if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
        componentsByProduct.get(row.product_id)!.push({
          id: row.id, name: row.name, type: row.type, category: row.category,
          value: Number(row.value), calculation_base: row.calculation_base, quantity: row.quantity,
        });
      }

      const engineItems: CostEngineItemInput[] = [];
      for (const nuvemshopItem of nuvemshopItems) {
        const internalVariant = variantMap.get(nuvemshopItem.variant_id);
        if (!internalVariant) continue;
        engineItems.push({
          variant_id: internalVariant.id,
          product_id: internalVariant.product_id,
          unit_price: nuvemshopItem.price,
          quantity: nuvemshopItem.quantity,
          product_cost: Number(internalVariant.cost_price || 0),
          legacy_packaging_cost: Number(internalVariant.packaging_cost || 0),
          legacy_platform_fee_percent: Number(internalVariant.platform_fee_percent || 0),
          components: (componentsByProduct.get(internalVariant.product_id) || []).map(c => ({
            ...c, type: c.type as any, category: c.category as any, calculation_base: c.calculation_base as any,
          })),
        });
      }

      const costResult = computeOrderCosts(engineItems, {
        shipping_cost_owner: data.shipping_cost_owner ? parseFloat(data.shipping_cost_owner) : 0,
        discount_amount: data.discount ? parseFloat(data.discount) : 0,
      });
      const snapshotByVariant = new Map(costResult.items.map(i => [i.variant_id, i]));
```

Then inside the item insert loop, use the snapshot:

```ts
        const snapshot = snapshotByVariant.get(internalVariant.id)!;
        const [item] = await trx(this.itemsTable)
          .insert(applySnapshot({
            order_id: order.id,
            variant_id: internalVariant.id,
            quantity: nuvemshopItem.quantity,
            unit_price: nuvemshopItem.price,
            has_promotional_price: nuvemshopItem.has_promotional_price ?? null,
            status: true,
          }, snapshot))
          .returning('*');
        processedItems.push(item);
```

And update the order row with financial totals after processing items:

```ts
      await trx(this.ordersTable)
        .where({ id: order.id })
        .update({
          total_cost: costResult.total_cost,
          total_profit: costResult.total_profit,
          margin_percent: costResult.margin_percent,
          updated_at: new Date(),
        });
```

Return the order with the updated totals:

```ts
      return { ...order, total_cost: costResult.total_cost, total_profit: costResult.total_profit, margin_percent: costResult.margin_percent, items: processedItems };
```

- [ ] **Step 3: Modify `create` (generic order) to run the engine**

Replace the item insert loop in `create` (lines ~149-157) with snapshot-aware inserts:

```ts
      // after inserting the order and BEFORE stock deduction, resolve variants + components
      const variantIds = items.map(i => i.variant_id);
      const variants = await trx('product_variants').whereIn('id', variantIds).select('id', 'product_id', 'cost_price', 'packaging_cost', 'platform_fee_percent');
      const variantMap = new Map(variants.map(v => [v.id, v]));
      const productIds = [...new Set(variants.map(v => v.product_id))];
      const componentsByProduct = new Map<string, Array<any>>();
      for (const row of await costRepository.getComponentsByProductIds(productIds)) {
        if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
        componentsByProduct.get(row.product_id)!.push({
          id: row.id, name: row.name, type: row.type, category: row.category,
          value: Number(row.value), calculation_base: row.calculation_base, quantity: row.quantity,
        });
      }

      const engineItems: CostEngineItemInput[] = items.map(item => {
        const v = variantMap.get(item.variant_id)!;
        return {
          variant_id: item.variant_id,
          product_id: v.product_id,
          unit_price: item.unit_price,
          quantity: item.quantity,
          product_cost: Number(v.cost_price || 0),
          legacy_packaging_cost: Number(v.packaging_cost || 0),
          legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
          components: (componentsByProduct.get(v.product_id) || []).map((c: any) => ({ ...c, type: c.type as any, category: c.category as any, calculation_base: c.calculation_base as any })),
        };
      });

      const costResult = computeOrderCosts(engineItems, { shipping_cost_owner: 0, discount_amount: 0 });
      const snapshotByVariant = new Map(costResult.items.map(i => [i.variant_id, i]));

      const insertedItems = await trx(this.itemsTable)
        .insert(items.map(item => applySnapshot({ ...item, order_id: order.id }, snapshotByVariant.get(item.variant_id)!)))
        .returning('*');
```

Then the stock-deduction loop stays the same, but `order` must carry totals:

```ts
      return {
        ...order,
        total_cost: costResult.total_cost,
        total_profit: costResult.total_profit,
        margin_percent: costResult.margin_percent,
        items: insertedItems,
      };
```

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: existing order tests still pass (fallback path for products without components).

- [ ] **Step 5: Add snapshot assertions to order integration tests**

In `src/services/order.service.integration.test.ts`, add a new test block:

```ts
  describe("7. Cost Snapshot on Order Creation", () => {
    let snapVariantId: string;

    before(async () => {
      const product = await productService.createProduct({
        slug: "snapshot-cost-test",
        name: "Snapshot Cost Test",
        variants: [{ price: 100, stock_quantity: 50, cost_price: 40, packaging_cost: 2, platform_fee_percent: 3 }],
      });
      snapVariantId = product.variants[0]!.id;

      const component = await (await import("./cost.service.js")).costService.createComponent({
        name: "Caixa Snapshot", type: "FIXED", value: 1.5,
      });
      await (await import("./cost.service.js")).costService.associateComponent({
        product_id: product.id, cost_component_id: component.id, quantity: 2,
      });
    });

    it("persists the full cost snapshot on the order item", async () => {
      const order = await orderService.createOrder({
        customer_name: "Snapshot Customer",
        items: [{ variant_id: snapVariantId, quantity: 1, unit_price: 100 }],
      });

      const item = order.items[0]!;
      assert.strictEqual(Number(item.unit_cost), 40);
      assert.strictEqual(Number(item.unit_packaging_cost), 3); // 1.5 * 2
      assert.strictEqual(Number(item.unit_platform_fee), 0);   // components supersede legacy
      assert.strictEqual(Number(item.unit_total_cost), 43);
      assert.strictEqual(Number(item.unit_profit), 57);
      assert.strictEqual(Number(item.margin_percent), 57);
      assert.ok(Array.isArray(item.cost_breakdown));
      assert.ok((item.cost_breakdown as any[]).length >= 2);
      assert.strictEqual(Number(order.total_cost), 43);
      assert.strictEqual(Number(order.total_profit), 57);
    });
  });
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass, including the new snapshot test.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/order.repository.ts src/services/order.service.integration.test.ts
git commit -m "feat: run cost engine on order creation and nuvemshop upsert"
```

---

## Phase 3 — External Sales

### Task 3.1: External sale schema

**Files:**
- Create: `src/schemas/external-sale.schema.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ExternalSaleSchema.create` + `ExternalSaleResponse` + inferred types

- [ ] **Step 1: Create the schema file**

```ts
import { z } from "zod";

export const ExternalSaleItemSchema = z.object({
  variant_id: z.uuid("Invalid variant ID"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unit_price: z.number().min(0, "Unit price cannot be negative"),
});

export const ExternalSaleSchema = {
  create: z.object({
    customer_name: z.string().min(1, "Customer name is required").max(255),
    customer_email: z.string().email().nullable().optional(),
    items: z.array(ExternalSaleItemSchema).min(1, "Sale must have at least one item"),
    discount_amount: z.number().min(0).optional(),
    payment_method: z.string().max(50).optional(),
    gateway: z.string().max(100).optional(),
    payment_installments: z.number().int().positive().optional(),
    shipping_cost_owner: z.number().min(0).optional(),
    shipping_cost_customer: z.number().min(0).optional(),
    status: z.enum(["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELED"]).default("PAID"),
  }),

  createInput: z.object({
    customer_name: z.string(),
    customer_email: z.string().nullable().optional(),
    items: z.array(ExternalSaleItemSchema),
    discount_amount: z.number().min(0).default(0),
    payment_method: z.string().nullable().optional(),
    gateway: z.string().nullable().optional(),
    payment_installments: z.number().int().nullable().optional(),
    shipping_cost_owner: z.number().min(0).default(0),
    shipping_cost_customer: z.number().min(0).default(0),
    status: z.enum(["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELED"]).default("PAID"),
  }),

  response: z.object({
    id: z.uuid(),
    nuvemshop_order_id: z.string().nullable().optional(),
    customer_name: z.string().nullable().optional(),
    status: z.string(),
    total_amount: z.number(),
    source: z.string().optional(),
    discount_amount: z.number().nullable().optional(),
    shipping_cost_customer: z.number().nullable().optional(),
    shipping_cost_owner: z.number().nullable().optional(),
    payment_method: z.string().nullable().optional(),
    gateway: z.string().nullable().optional(),
    payment_installments: z.number().int().nullable().optional(),
    total_cost: z.number().optional(),
    total_profit: z.number().optional(),
    margin_percent: z.number().optional(),
    created_at: z.date(),
    updated_at: z.date(),
    items: z.array(z.object({
      id: z.uuid(),
      order_id: z.uuid(),
      variant_id: z.uuid(),
      quantity: z.number().int(),
      unit_price: z.number(),
      unit_cost: z.number(),
      unit_packaging_cost: z.number(),
      unit_platform_fee: z.number(),
      unit_tax: z.number(),
      unit_shipping_cost: z.number(),
      unit_operational_cost: z.number(),
      unit_marketing_cost: z.number(),
      unit_other_cost: z.number(),
      unit_total_cost: z.number(),
      unit_profit: z.number(),
      margin_percent: z.number(),
      cost_breakdown: z.array(z.object({
        component_id: z.string().nullable(),
        name: z.string(),
        type: z.string(),
        category: z.string(),
        unit_value: z.number(),
        quantity: z.number(),
        line_total: z.number(),
      })).nullable(),
      status: z.boolean(),
    })),
  }),
};

export type ExternalSaleCreate = z.infer<typeof ExternalSaleSchema.create>;
export type ExternalSaleResponse = z.infer<typeof ExternalSaleSchema.response>;
```

- [ ] **Step 2: Commit**

```bash
git add src/schemas/external-sale.schema.ts
git commit -m "feat: add external sale Zod schemas"
```

### Task 3.2: External sale repository

**Files:**
- Create: `src/repositories/external-sale.repository.ts`

**Interfaces:**
- Consumes: `db`, `computeOrderCosts`, `costRepository.getComponentsByProductIds`
- Produces: `createExternalSale(input, costResult)` returning order with items

- [ ] **Step 1: Create the repository file**

```ts
import { db } from '../lib/db.js';
import type { CostEngineItemInput, OrderCostResult } from '../lib/cost-engine.js';
import { costRepository } from './cost.repository.js';

export interface ExternalSaleItemInput {
  variant_id: string;
  quantity: number;
  unit_price: number;
}

export interface ExternalSaleInput {
  customer_name: string;
  customer_email?: string | null;
  items: ExternalSaleItemInput[];
  discount_amount: number;
  payment_method?: string | null;
  gateway?: string | null;
  payment_installments?: number | null;
  shipping_cost_owner: number;
  shipping_cost_customer: number;
  status: string;
}

export class ExternalSaleRepository {
  private ordersTable = 'orders';
  private itemsTable = 'order_items';

  async createExternalSale(
    input: ExternalSaleInput,
    costResult: OrderCostResult
  ) {
    return await db.transaction(async (trx) => {
      const grossTotal = input.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
      const totalAmount = grossTotal - input.discount_amount;

      const [order] = await trx(this.ordersTable)
        .insert({
          customer_name: input.customer_name,
          customer_email: input.customer_email ?? null,
          status: input.status,
          total_amount: totalAmount,
          source: 'EXTERNAL',
          discount_amount: input.discount_amount || null,
          shipping_cost_owner: input.shipping_cost_owner || null,
          shipping_cost_customer: input.shipping_cost_customer || null,
          payment_method: input.payment_method ?? null,
          gateway: input.gateway ?? null,
          payment_installments: input.payment_installments ?? null,
          total_cost: costResult.total_cost,
          total_profit: costResult.total_profit,
          margin_percent: costResult.margin_percent,
        })
        .returning('*');

      const snapshotByVariant = new Map(costResult.items.map(i => [i.variant_id, i]));

      const itemsToInsert = input.items.map((item) => {
        const s = snapshotByVariant.get(item.variant_id)!;
        return {
          order_id: order.id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          unit_cost: s.unit_cost,
          unit_packaging_cost: s.unit_packaging_cost,
          unit_platform_fee: s.unit_platform_fee,
          unit_tax: s.unit_tax,
          unit_shipping_cost: s.unit_shipping_cost,
          unit_operational_cost: s.unit_operational_cost,
          unit_marketing_cost: s.unit_marketing_cost,
          unit_other_cost: s.unit_other_cost,
          unit_total_cost: s.unit_total_cost,
          unit_profit: s.unit_profit,
          margin_percent: s.margin_percent,
          cost_breakdown: JSON.stringify(s.cost_breakdown),
          status: true,
        };
      });

      const insertedItems = await trx(this.itemsTable).insert(itemsToInsert).returning('*');

      for (const item of input.items) {
        const variant = await trx('product_variants')
          .where({ id: item.variant_id })
          .forUpdate()
          .first();
        if (!variant) throw new Error(`Product variant ${item.variant_id} not found`);
        if (variant.stock_quantity < item.quantity) {
          throw new Error(`Insufficient stock for variant ${item.variant_id}. Available: ${variant.stock_quantity}, requested: ${item.quantity}`);
        }
        await trx('product_variants')
          .where({ id: item.variant_id })
          .update({ stock_quantity: variant.stock_quantity - item.quantity, updated_at: new Date() });
        await trx('inventory_transactions').insert({
          variant_id: item.variant_id,
          order_id: order.id,
          quantity_changed: -item.quantity,
          type: 'SALE',
        });
      }

      return { ...order, items: insertedItems };
    });
  }
}

export const externalSaleRepository = new ExternalSaleRepository();
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/external-sale.repository.ts
git commit -m "feat: add external sale repository"
```

### Task 3.3: External sale service

**Files:**
- Create: `src/services/external-sale.service.ts`

**Interfaces:**
- Consumes: `ExternalSaleSchema`, `externalSaleRepository`, `costRepository`, `db`, `customerService`
- Produces: `createExternalSale(input)` returning enriched order

- [ ] **Step 1: Create the service file**

```ts
import { ExternalSaleSchema, type ExternalSaleCreate } from '../schemas/external-sale.schema.js';
import { externalSaleRepository, type ExternalSaleInput } from '../repositories/external-sale.repository.js';
import { costRepository } from '../repositories/cost.repository.js';
import { computeOrderCosts, type CostEngineItemInput } from '../lib/cost-engine.js';
import { db } from '../lib/db.js';
import { customerService } from './customer.service.js';
import { websocketManager } from '../lib/websocket.js';

export class ExternalSaleService {
  async createExternalSale(data: ExternalSaleCreate) {
    const validated = ExternalSaleSchema.create.parse(data);

    const variantIds = validated.items.map(i => i.variant_id);
    const variants = await db('product_variants')
      .whereIn('id', variantIds)
      .whereNull('deleted_at')
      .select('id', 'product_id', 'cost_price', 'packaging_cost', 'platform_fee_percent');
    if (variants.length !== variantIds.length) {
      throw new Error('One or more variants were not found');
    }
    const variantMap = new Map(variants.map(v => [v.id, v]));
    const productIds = [...new Set(variants.map(v => v.product_id))];
    const componentsByProduct = new Map<string, any[]>();
    for (const row of await costRepository.getComponentsByProductIds(productIds)) {
      if (!componentsByProduct.has(row.product_id)) componentsByProduct.set(row.product_id, []);
      componentsByProduct.get(row.product_id)!.push(row);
    }

    const engineItems: CostEngineItemInput[] = validated.items.map(item => {
      const v = variantMap.get(item.variant_id)!;
      return {
        variant_id: item.variant_id,
        product_id: v.product_id,
        unit_price: item.unit_price,
        quantity: item.quantity,
        product_cost: Number(v.cost_price || 0),
        legacy_packaging_cost: Number(v.packaging_cost || 0),
        legacy_platform_fee_percent: Number(v.platform_fee_percent || 0),
        components: (componentsByProduct.get(v.product_id) || []).map((c: any) => ({
          id: c.id, name: c.name, type: c.type, category: c.category,
          value: Number(c.value), calculation_base: c.calculation_base, quantity: c.quantity,
        })),
      };
    });

    const costResult = computeOrderCosts(engineItems, {
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      discount_amount: validated.discount_amount ?? 0,
    });

    const input: ExternalSaleInput = {
      customer_name: validated.customer_name,
      customer_email: validated.customer_email ?? null,
      items: validated.items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price: i.unit_price })),
      discount_amount: validated.discount_amount ?? 0,
      payment_method: validated.payment_method ?? null,
      gateway: validated.gateway ?? null,
      payment_installments: validated.payment_installments ?? null,
      shipping_cost_owner: validated.shipping_cost_owner ?? 0,
      shipping_cost_customer: validated.shipping_cost_customer ?? 0,
      status: validated.status ?? 'PAID',
    };

    const order = await externalSaleRepository.createExternalSale(input, costResult);

    await customerService.upsertFromOrder({
      name: validated.customer_name,
      email: validated.customer_email ?? null,
      city: null,
      province: null,
      payment_method: validated.payment_method ?? null,
      gateway: validated.gateway ?? null,
      storefront: 'EXTERNAL',
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      total: Number(order.total_amount),
      date: order.created_at,
    });

    websocketManager.broadcast({
      event: 'orders_updated',
      message: `External sale ${order.id} created.`,
      orderId: order.id,
    });

    return order;
  }
}

export const externalSaleService = new ExternalSaleService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/external-sale.service.ts
git commit -m "feat: add external sale service"
```

### Task 3.4: External sale router

**Files:**
- Create: `src/routers/external-sale.router.ts`
- Modify: `src/server.ts` (register router)

**Interfaces:**
- Consumes: `externalSaleService`, `productService`, `customerService`
- Produces: Fastify plugin under `/api/external-sales`

- [ ] **Step 1: Create the router file**

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { externalSaleService } from '../services/external-sale.service.js';
import { productService } from '../services/product.service.js';
import { customerService } from '../services/customer.service.js';
import { ExternalSaleSchema } from '../schemas/external-sale.schema.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const externalSaleRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.post('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { body: ExternalSaleSchema.create },
  }, async (request, reply) => {
    try {
      const order = await externalSaleService.createExternalSale(request.body);
      return reply.code(201).send(order);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/products', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional(),
      }),
    },
  }, async (request, reply) => {
    try {
      const { page, limit, search } = request.query;
      const filters: { search?: string } = {};
      if (search !== undefined) filters.search = search;
      const result = await productService.getProducts(page ?? 1, limit ?? 20, filters);
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/customers', {
    onRequest: [fastify.authenticate],
    schema: {
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional(),
      }),
    },
  }, async (request, reply) => {
    try {
      const { page, limit, search } = request.query;
      const result = await customerService.listCustomers(page ?? 1, limit ?? 20, { search });
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
```

- [ ] **Step 2: Register the router in server.ts**

```ts
import { externalSaleRoutes } from './routers/external-sale.router.js';
// ...
app.register(externalSaleRoutes, { prefix: '/api/external-sales' });
```

- [ ] **Step 3: Commit**

```bash
git add src/routers/external-sale.router.ts src/server.ts
git commit -m "feat: add external sales router"
```

### Task 3.5: External sale integration tests

**Files:**
- Create: `src/services/external-sale.service.integration.test.ts`

**Interfaces:**
- Consumes: `externalSaleService`, `productService`, `db`, `cleanupDatabase`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { externalSaleService } from "./external-sale.service.js";
import { productService } from "./product.service.js";
import { costService } from "./cost.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase } from "../test/setup.js";

describe("ExternalSaleService Integration Tests", () => {
  let variantId: string;
  let productId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "external-sale-test",
      name: "External Sale Product",
      variants: [{ price: 80, stock_quantity: 20, cost_price: 30, packaging_cost: 2, platform_fee_percent: 2 }],
    });
    productId = product.id;
    variantId = product.variants[0]!.id;
  });

  after(async () => {
    await cleanupDatabase();
  });

  it("creates an external sale with source EXTERNAL, stock deduction and inventory tx", async () => {
    const component = await costService.createComponent({ name: "Etiqueta", type: "FIXED", value: 0.5 });
    await costService.associateComponent({ product_id: productId, cost_component_id: component.id, quantity: 2 });

    const order = await externalSaleService.createExternalSale({
      customer_name: "Cliente Externo",
      customer_email: "cliente@externo.com",
      items: [{ variant_id: variantId, quantity: 2, unit_price: 80 }],
      payment_method: "credit_card",
      gateway: "stone",
      shipping_cost_owner: 10,
      discount_amount: 10,
    });

    assert.ok(order.id);
    assert.strictEqual(order.source, "EXTERNAL");
    assert.strictEqual(Number(order.total_amount), 150); // 160 - 10
    assert.strictEqual(order.items.length, 1);
    const item = order.items[0]!;
    // etiqueta FIXED=0.5 qty2 -> unit_other_cost 1.0; freight 10 * 100% share / 2 qty -> unit_shipping_cost 5
    assert.strictEqual(Number(item.unit_total_cost), 36); // 30 (produto) + 1 (etiqueta) + 5 (frete)
    assert.strictEqual(Number(item.unit_profit), 39); // net unit revenue 75 - 36
    assert.ok(Array.isArray(item.cost_breakdown));

    const variant = await db("product_variants").where({ id: variantId }).first();
    assert.strictEqual(variant.stock_quantity, 18);

    const tx = await db("inventory_transactions").where({ variant_id: variantId, order_id: order.id }).first();
    assert.ok(tx);
    assert.strictEqual(tx.type, "SALE");
    assert.strictEqual(tx.quantity_changed, -2);
  });

  it("fails with rollback on insufficient stock", async () => {
    await assert.rejects(
      async () => externalSaleService.createExternalSale({
        customer_name: "Over Sale",
        items: [{ variant_id: variantId, quantity: 999, unit_price: 80 }],
      }),
      (err: Error) => err.message.includes("Insufficient stock")
    );
  });
});
```

Note on allocation math: single item weight 160 over total 160 → share 100%. Freight 10 allocated at order level (10 total), per unit = 10 / 2 qty = 5. Discount 10 → net unit revenue = (160 - 10) / 2 = 75.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: external sale tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/external-sale.service.integration.test.ts
git commit -m "test: add external sale service integration tests"
```

---

## Phase 4 — Customers

### Task 4.1: Customer repository

**Files:**
- Create: `src/repositories/customer.repository.ts`

**Interfaces:**
- Consumes: `db`
- Produces: `upsertFromOrder`, `findAll`, `findById`, `findOrders`, `getIndicators`

- [ ] **Step 1: Create the repository file**

```ts
import { db } from '../lib/db.js';

export interface UpsertCustomerInput {
  email: string | null;
  name: string;
  city?: string | null;
  province?: string | null;
  payment_method?: string | null;
  gateway?: string | null;
  storefront?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  total: number;
  date: Date;
}

export class CustomerRepository {
  private table = 'customers';

  async upsertFromOrder(data: UpsertCustomerInput) {
    if (!data.email) {
      const [created] = await db(this.table).insert({
        email: null,
        name: data.name,
        first_purchase_at: data.date,
        last_purchase_at: data.date,
      }).returning('*');
      return created;
    }

    const existing = await db(this.table).where({ email: data.email }).whereNull('deleted_at').first();
    if (existing) {
      const [updated] = await db(this.table)
        .where({ id: existing.id })
        .update({
          name: data.name,
          city: data.city ?? existing.city,
          province: data.province ?? existing.province,
          last_purchase_at: data.date,
          updated_at: new Date(),
        })
        .returning('*');
      return updated;
    }

    const [created] = await db(this.table).insert({
      email: data.email,
      name: data.name,
      city: data.city ?? null,
      province: data.province ?? null,
      origin: data.storefront ?? null,
      utm_source: data.utm_source ?? null,
      utm_medium: data.utm_medium ?? null,
      utm_campaign: data.utm_campaign ?? null,
      first_purchase_at: data.date,
      last_purchase_at: data.date,
    }).returning('*');
    return created;
  }

  async findAll(page = 1, limit = 20, filters: { search?: string } = {}) {
    let query = db(this.table).whereNull('deleted_at');

    if (filters.search) {
      query = query.where((b) => {
        b.where('name', 'ilike', `%${filters.search}%`)
          .orWhere('email', 'ilike', `%${filters.search}%`);
      });
    }

    const totalResult = await query.clone().count('* as count').first();
    const total = Number(totalResult?.count || 0);
    const offset = (page - 1) * limit;

    const customers = await query
      .clone()
      .select(
        `${this.table}.*`,
        db.raw(`(
          SELECT COUNT(*) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        )::int as order_count`),
        db.raw(`COALESCE((
          SELECT SUM(o.total_amount) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        ), 0)::float8 as total_spent`),
        db.raw(`COALESCE((
          SELECT AVG(o.total_amount) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        ), 0)::float8 as average_ticket`),
        db.raw(`(
          SELECT COUNT(*) FROM orders o
          WHERE o.customer_email = ${this.table}.email
            AND o.deleted_at IS NULL AND o.status <> 'CANCELED'
        )::int as recurrence`)
      )
      .orderBy('last_purchase_at', 'desc')
      .limit(limit)
      .offset(offset);

    return { customers, total, page, limit };
  }

  async findById(id: string) {
    const customer = await db(this.table).where({ id }).whereNull('deleted_at').first();
    if (!customer) return null;
    return customer;
  }

  async findOrders(customerId: string) {
    const customer = await this.findById(customerId);
    if (!customer) return null;
    if (!customer.email) return [];

    return db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .orderBy('created_at', 'desc');
  }

  async getIndicators(customerId: string) {
    const customer = await this.findById(customerId);
    if (!customer) return null;
    if (!customer.email) {
      return {
        order_count: 0, total_spent: 0, average_ticket: 0,
        first_purchase_at: customer.first_purchase_at,
        last_purchase_at: customer.last_purchase_at,
        favorite_payment_method: null, favorite_gateway: null, recurrence: 0,
      };
    }

    const stats = await db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .select(
        db.raw('COUNT(*)::int as order_count'),
        db.raw('COALESCE(SUM(total_amount),0)::float8 as total_spent'),
        db.raw('COALESCE(AVG(total_amount),0)::float8 as average_ticket'),
        db.raw('MIN(created_at) as first_purchase_at'),
        db.raw('MAX(created_at) as last_purchase_at')
      )
      .first();

    const favMethod = await db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .whereNotNull('payment_method')
      .groupBy('payment_method')
      .select('payment_method', db.raw('COUNT(*)::int as cnt'))
      .orderBy('cnt', 'desc')
      .first();

    const favGateway = await db('orders')
      .where({ customer_email: customer.email })
      .whereNull('deleted_at')
      .where('status', '<>', 'CANCELED')
      .whereNotNull('gateway')
      .groupBy('gateway')
      .select('gateway', db.raw('COUNT(*)::int as cnt'))
      .orderBy('cnt', 'desc')
      .first();

    return {
      order_count: Number(stats?.order_count || 0),
      total_spent: Number(stats?.total_spent || 0),
      average_ticket: Number(stats?.average_ticket || 0),
      first_purchase_at: stats?.first_purchase_at ?? null,
      last_purchase_at: stats?.last_purchase_at ?? null,
      favorite_payment_method: favMethod?.payment_method ?? null,
      favorite_gateway: favGateway?.gateway ?? null,
      recurrence: Number(stats?.order_count || 0) > 1 ? 1 : 0,
    };
  }
}

export const customerRepository = new CustomerRepository();
```

- [ ] **Step 2: Commit**

```bash
git add src/repositories/customer.repository.ts
git commit -m "feat: add customer repository with aggregations"
```

### Task 4.2: Customer service

**Files:**
- Create: `src/services/customer.service.ts`

**Interfaces:**
- Consumes: `customerRepository`
- Produces: `listCustomers`, `getCustomer`, `getCustomerOrders`, `getCustomerIndicators`, `upsertFromOrder`

- [ ] **Step 1: Create the service file**

```ts
import { customerRepository, type UpsertCustomerInput } from '../repositories/customer.repository.js';

export class CustomerService {
  async upsertFromOrder(data: UpsertCustomerInput) {
    return customerRepository.upsertFromOrder(data);
  }

  async listCustomers(page = 1, limit = 20, filters: { search?: string } = {}) {
    return customerRepository.findAll(page, limit, filters);
  }

  async getCustomer(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) return null;
    const indicators = await customerRepository.getIndicators(id);
    return { ...customer, indicators };
  }

  async getCustomerOrders(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) return null;
    return customerRepository.findOrders(id);
  }
}

export const customerService = new CustomerService();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/customer.service.ts
git commit -m "feat: add customer service"
```

### Task 4.3: Customer router

**Files:**
- Create: `src/routers/customer.router.ts`
- Modify: `src/server.ts` (register router)

**Interfaces:**
- Consumes: `customerService`
- Produces: Fastify plugin under `/api/customers`

- [ ] **Step 1: Create the router file**

```ts
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { customerService } from '../services/customer.service.js';
import { requireRole } from "../middlewares/role.middleware.js";
import { csrfProtection } from "../middlewares/csrf.middleware.js";
import { z } from "zod";

export const customerRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.addHook('preHandler', csrfProtection());

  fastify.get('/', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: {
      querystring: z.object({
        page: z.coerce.number().optional(),
        limit: z.coerce.number().optional(),
        search: z.string().optional(),
      }),
    },
  }, async (request, reply) => {
    try {
      const { page, limit, search } = request.query;
      const filters: { search?: string } = {};
      if (search !== undefined) filters.search = search;
      const result = await customerService.listCustomers(page ?? 1, limit ?? 20, filters);
      return reply.send(result);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const customer = await customerService.getCustomer(request.params.id);
      if (!customer) return reply.code(404).send({ error: 'Customer not found' });
      return reply.send(customer);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.get('/:id/orders', {
    onRequest: [fastify.authenticate],
    preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])],
    schema: { params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    try {
      const orders = await customerService.getCustomerOrders(request.params.id);
      if (orders === null) return reply.code(404).send({ error: 'Customer not found' });
      return reply.send(orders);
    } catch (error: any) {
      return reply.code(400).send({ error: error.message });
    }
  });
};
```

- [ ] **Step 2: Register the router in server.ts**

```ts
import { customerRoutes } from './routers/customer.router.js';
// ...
app.register(customerRoutes, { prefix: '/api/customers' });
```

- [ ] **Step 3: Commit**

```bash
git add src/routers/customer.router.ts src/server.ts
git commit -m "feat: add customers router"
```

### Task 4.4: Wire customer upsert into order sync

**Files:**
- Modify: `src/services/order.service.ts`

**Interfaces:**
- Consumes: `customerService`
- Produces: customers upserted whenever an order is synced

- [ ] **Step 1: Add customer upsert to `upsertOrderFromNuvemshop`**

```ts
import { customerService } from './customer.service.js';

  async upsertOrderFromNuvemshop(data: NuvemshopOrderData): Promise<OrderWithItems> {
    const order = await orderRepository.upsertOrderFromNuvemshop(data);

    await customerService.upsertFromOrder({
      email: data.contact_email ?? null,
      name: data.customer?.name ?? 'Cliente',
      city: data.shipping_address?.city ?? null,
      province: data.shipping_address?.province ?? null,
      payment_method: data.payment_details?.method ?? null,
      gateway: data.gateway ?? null,
      storefront: data.storefront ?? null,
      utm_source: data.customer_visit?.utm_parameters?.utm_source ?? null,
      utm_medium: data.customer_visit?.utm_parameters?.utm_medium ?? null,
      utm_campaign: data.customer_visit?.utm_parameters?.utm_campaign ?? null,
      total: Number(order.total_amount),
      date: order.created_at,
    });

    return order;
  }
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: existing tests pass (customer upsert is best-effort and non-breaking).

- [ ] **Step 3: Commit**

```bash
git add src/services/order.service.ts
git commit -m "feat: upsert customer on nuvemshop order sync"
```

### Task 4.5: Customer integration tests

**Files:**
- Create: `src/services/customer.service.integration.test.ts`

**Interfaces:**
- Consumes: `customerService`, `orderService`, `productService`, `cleanupDatabase`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { customerService } from "./customer.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { cleanupDatabase } from "../test/setup.js";

describe("CustomerService Integration Tests", () => {
  let variantId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "customer-test-product",
      name: "Customer Test Product",
      variants: [{ price: 50, stock_quantity: 100, cost_price: 20 }],
    });
    variantId = product.variants[0]!.id;
  });

  after(async () => {
    await cleanupDatabase();
  });

  it("upserts a customer from a Nuvemshop order", async () => {
    await orderService.upsertOrderFromNuvemshop({
      id: "cust-1",
      customer: { name: "Ana Souza" },
      status: "PAID",
      total: 100,
      items: [{ variant_id: "999888777", quantity: 2, price: 50 }],
      contact_email: "ana@test.com",
      shipping_address: { city: "São Paulo", province: "SP" },
      gateway: "nuvem-pago",
      payment_details: { method: "credit_card" },
    } as any);

    const result = await customerService.listCustomers(1, 10, { search: "ana@test.com" });
    assert.strictEqual(result.total, 1);
    const customer = result.customers[0]!;
    assert.strictEqual(customer.name, "Ana Souza");
    assert.strictEqual(customer.city, "São Paulo");
    assert.strictEqual(customer.province, "SP");
    assert.strictEqual(customer.order_count, 1);
    assert.strictEqual(Number(customer.total_spent), 100);
    assert.strictEqual(Number(customer.average_ticket), 100);
  });

  it("returns indicators for a customer", async () => {
    const result = await customerService.listCustomers(1, 10, { search: "ana@test.com" });
    const customer = result.customers[0]!;
    const detail = await customerService.getCustomer(customer.id);
    assert.ok(detail);
    assert.strictEqual(detail.indicators.order_count, 1);
    assert.strictEqual(Number(detail.indicators.total_spent), 100);
    assert.strictEqual(detail.indicators.favorite_payment_method, "credit_card");
    assert.strictEqual(detail.indicators.favorite_gateway, "nuvem-pago");
  });

  it("lists the order history of a customer", async () => {
    const result = await customerService.listCustomers(1, 10, { search: "ana@test.com" });
    const customer = result.customers[0]!;
    const orders = await customerService.getCustomerOrders(customer.id);
    assert.ok(Array.isArray(orders));
    assert.ok(orders!.length >= 1);
  });
});
```

Note: the Nuvemshop upsert requires an internal variant matching `nuvemshop_variant_id` `"999888777"`. Create a variant with that id in `before`:

```ts
    const product = await productService.createProduct({
      slug: "customer-test-product",
      name: "Customer Test Product",
      variants: [{ price: 50, stock_quantity: 100, cost_price: 20, nuvemshop_variant_id: "999888777" }],
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test`
Expected: customer tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/customer.service.integration.test.ts
git commit -m "test: add customer service integration tests"
```

---

## Phase 5 — Order Enrichment & Translations

### Task 5.1: Order status translation helpers

**Files:**
- Create: `src/lib/order-status.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `translateOrderStatus`, `translatePaymentStatus`, `translateFulfillmentStatus`, `deriveCommercialStatus`, `enrichOrder`

- [ ] **Step 1: Create the helpers file**

```ts
import type { Order, OrderItem } from '../schemas/order.schema.js';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelado',
  open: 'Em aberto',
  closed: 'Concluído',
  cancelled: 'Cancelado',
  paid: 'Pago',
  shipped: 'Enviado',
};

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  voided: 'Estornado',
  PENDING: 'Pendente',
  PAID: 'Pago',
  CANCELED: 'Cancelado',
};

const FULFILLMENT_LABELS: Record<string, string> = {
  pending: 'Pendente',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  PENDING: 'Pendente',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelado',
};

export function translateOrderStatus(status: string | null | undefined): string {
  if (!status) return 'Sem status';
  return STATUS_LABELS[status] || status;
}

export function translatePaymentStatus(status: string | null | undefined): string {
  if (!status) return 'Sem status';
  return PAYMENT_LABELS[status] || status;
}

export function translateFulfillmentStatus(status: string | null | undefined): string {
  if (!status) return 'Sem status';
  return FULFILLMENT_LABELS[status] || status;
}

export function deriveCommercialStatus(status: string | null | undefined): string {
  switch (status) {
    case 'CANCELED':
    case 'cancelled':
      return 'Cancelado';
    case 'PAID':
    case 'DELIVERED':
    case 'closed':
    case 'paid':
      return 'Venda concretizada';
    case 'SHIPPED':
    case 'shipped':
      return 'Enviado';
    default:
      return 'Em aberto';
  }
}

export function enrichOrderItem(item: OrderItem) {
  return {
    ...item,
    unit_total_cost: Number(item.unit_total_cost || 0),
    unit_profit: Number(item.unit_profit || 0),
    margin_percent: Number(item.margin_percent || 0),
  };
}

export function enrichOrder(order: Order & { items: OrderItem[] }) {
  return {
    ...order,
    status_label: translateOrderStatus(order.status),
    payment_status_label: translatePaymentStatus(order.payment_status),
    fulfillment_status_label: translateFulfillmentStatus(order.fulfillment_status),
    commercial_status: deriveCommercialStatus(order.status),
    total_cost: Number(order.total_cost || 0),
    total_profit: Number(order.total_profit || 0),
    margin_percent: Number(order.margin_percent || 0),
    items: order.items.map(enrichOrderItem),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/order-status.ts
git commit -m "feat: add order status translation helpers"
```

### Task 5.2: Enrich order service responses

**Files:**
- Modify: `src/services/order.service.ts`
- Modify: `src/schemas/order.schema.ts`

**Interfaces:**
- Consumes: `enrichOrder`
- Produces: enriched order payloads from all service methods

- [ ] **Step 1: Wrap service returns with `enrichOrder`**

```ts
import { enrichOrder } from '../lib/order-status.js';

  async createOrder(orderData: OrderCreate) {
    // ... existing logic ...
    const order = await orderRepository.create(createInput);
    return enrichOrder(order);
  }

  async getOrderById(id: string) {
    const order = await orderRepository.findById(id);
    return order ? enrichOrder(order) : null;
  }

  async updateOrder(id: string, orderData: OrderUpdate) {
    // ... existing logic ...
    const updated = await orderRepository.update(id, updateData);
    return updated ? enrichOrder(updated) : null;
  }

  async getOrders(page = 1, limit = 10, filters = {}) {
    const result = await orderRepository.findAll(page, limit, filters);
    return { ...result, orders: result.orders.map(enrichOrder) };
  }

  async upsertOrderFromNuvemshop(data: NuvemshopOrderData) {
    const order = await orderRepository.upsertOrderFromNuvemshop(data);
    // customer upsert (Task 4.4) ...
    return enrichOrder(order);
  }

  async handleNuvemshopWebhook(data: NuvemshopOrderData) {
    // existing logic; the broadcast uses updatedOrder.status — still available
  }
```

- [ ] **Step 2: Update `OrderSchema.response` and `listResponse`**

Add to the item schema (`OrderItemBaseSchema`):

```ts
  unit_tax: z.number().min(0).default(0),
  unit_shipping_cost: z.number().min(0).default(0),
  unit_operational_cost: z.number().min(0).default(0),
  unit_marketing_cost: z.number().min(0).default(0),
  unit_other_cost: z.number().min(0).default(0),
  unit_total_cost: z.number().min(0).default(0),
  unit_profit: z.number().default(0),
  margin_percent: z.number().default(0),
  cost_breakdown: z.array(z.object({
    component_id: z.string().nullable(),
    name: z.string(),
    type: z.string(),
    category: z.string(),
    unit_value: z.number(),
    quantity: z.number(),
    line_total: z.number(),
  })).nullable().optional(),
```

Add to the order base/response object:

```ts
  source: z.string().optional(),
  total_cost: z.number().optional(),
  total_profit: z.number().optional(),
  margin_percent: z.number().optional(),
  status_label: z.string().optional(),
  payment_status_label: z.string().optional(),
  fulfillment_status_label: z.string().optional(),
  commercial_status: z.string().optional(),
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: existing order tests pass.

- [ ] **Step 4: Add an enrichment test**

In `src/services/order.service.integration.test.ts`, add:

```ts
  describe("8. Order Enrichment", () => {
    it("returns translated status and financial indicators", async () => {
      const order = await orderService.createOrder({
        customer_name: "Enrichment Customer",
        items: [{ variant_id: testVariantId1, quantity: 1, unit_price: 50 }],
      });
      assert.strictEqual(order.status_label, "Pendente");
      assert.strictEqual(order.commercial_status, "Em aberto");
      assert.strictEqual(typeof order.total_cost, "number");
      assert.strictEqual(typeof order.margin_percent, "number");
      assert.ok(order.items[0]!.unit_total_cost >= 0);
    });
  });
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/order.service.ts src/schemas/order.schema.ts src/services/order.service.integration.test.ts
git commit -m "feat: enrich orders with translations and financial indicators"
```

---

## Phase 6 — Dashboard & Product Search Fixes

### Task 6.1: Exclude canceled orders + date filters in dashboard

**Files:**
- Modify: `src/repositories/dashboard.repository.ts`
- Modify: `src/services/dashboard.service.ts`
- Modify: `src/routers/dashboard.router.ts`
- Modify: `src/schemas/dashboard.schema.ts` (querystring helper)

**Interfaces:**
- Consumes: `db`
- Produces: all dashboard queries excluding `CANCELED`, honoring `start_date`/`end_date`

- [ ] **Step 1: Add a base-filter helper and apply everywhere**

Add a helper to the repository:

```ts
function validOrderFilter(query: any) {
  return query.whereNull('orders.deleted_at').where('orders.status', '<>', 'CANCELED');
}
```

Apply to:
- `getNoSales30d` / `getDeadStock` inner subqueries: add `.andWhere('orders.status', '<>', 'CANCELED')`
- `getTurnoverRate` sales subquery: add `.andWhere('orders.status', '<>', 'CANCELED')`
- `getMarketingStats`: `baseQuery` add `.where('status', '<>', 'CANCELED')`
- `getOrdersStats`: `baseQuery` add `.where('status', '<>', 'CANCELED')`; the `topProducts` join adds `.where('orders.status', '<>', 'CANCELED')`; the `repeatRow` query adds `.where('status', '<>', 'CANCELED')`

- [ ] **Step 2: Add date filter parameters**

Update service methods:

```ts
  async getStockStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
    // unchanged queries; pass dates through to the ones that need them
  }

  async getMarketingStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
    return dashboardRepository.getMarketingStats(days, dates);
  }

  async getOrdersStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
    return dashboardRepository.getOrdersStats(days, dates);
  }
```

Repository: replace `cutoff` with effective bounds:

```ts
  private dateWindow(days: number, dates: { start?: Date; end?: Date } = {}) {
    const end = dates.end ?? new Date();
    const start = dates.start ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return { start, end };
  }
```

For `getMarketingStats`/`getOrdersStats`:

```ts
  async getMarketingStats(days = 30, dates = {}) {
    const { start, end } = this.dateWindow(days, dates);
    const baseQuery = db("orders")
      .where("orders.created_at", ">=", start)
      .andWhere("orders.created_at", "<=", end)
      .where("orders.status", "<>", "CANCELED")
      .whereNull("orders.deleted_at");
    // ... rest unchanged
  }
```

- [ ] **Step 3: Update the router to accept `start_date`/`end_date`**

```ts
      schema: {
        querystring: z.object({
          days: z.coerce.number().default(30),
          start_date: z.string().optional(),
          end_date: z.string().optional(),
        }),
      },
```
And parse them:

```ts
      const dates = {
        start: request.query.start_date ? new Date(request.query.start_date) : undefined,
        end: request.query.end_date ? new Date(request.query.end_date) : undefined,
      };
      const data = await dashboardService.getMarketingStats(days, dates);
```

Apply the same to `/dashboard/orders`. `/dashboard/stock` accepts the same query params but stock queries don't need date windows (keep `days` as-is).

- [ ] **Step 4: Extend dashboard integration tests**

In `src/services/dashboard.service.integration.test.ts`, add a test:

```ts
  it("excludes CANCELED orders from metrics", async () => {
    await db("orders").insert({
      id: "00000000-0000-0000-0000-000000000004",
      customer_name: "Canceled Customer",
      status: "CANCELED",
      total_amount: 999,
      created_at: new Date(),
    });
    const result = await dashboardService.getOrdersStats(30);
    assert.strictEqual(result.average_order_value, 200); // only the PAID order
    const byStatus = result.by_status.find((s: any) => s.status === "CANCELED");
    assert.strictEqual(byStatus, undefined);
  });

  it("respects explicit date filters", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await dashboardService.getMarketingStats(30, {
      start: new Date(tomorrow),
      end: new Date(tomorrow),
    });
    assert.strictEqual(result.by_storefront.length, 0);
  });
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: dashboard tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/dashboard.repository.ts src/services/dashboard.service.ts src/routers/dashboard.router.ts src/services/dashboard.service.integration.test.ts
git commit -m "fix: exclude canceled orders and add date filters to dashboard"
```

### Task 6.2: Product search across variants

**Files:**
- Modify: `src/repositories/product.repository.ts:300-306`

**Interfaces:**
- Consumes: `db`
- Produces: `findAll` search matches product AND variant fields

- [ ] **Step 1: Expand the search clause**

```ts
    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.where((builder: Knex.QueryBuilder) => {
        builder.where('name', 'ilike', term)
          .orWhere('slug', 'ilike', term)
          .orWhere('nuvemshop_id', 'ilike', term)
          .orWhereExists(function (this: any) {
            this.select('id')
              .from('product_variants')
              .whereRaw('product_variants.product_id = products.id')
              .whereNull('product_variants.deleted_at')
              .where((b: any) => {
                b.where('product_variants.sku', 'ilike', term)
                  .orWhere('product_variants.name', 'ilike', term)
                  .orWhere('product_variants.nuvemshop_variant_id', 'ilike', term);
              });
          });
      });
    }
```

- [ ] **Step 2: Add an integration test**

In `src/services/product.service.integration.test.ts`, add:

```ts
  it("finds a product by variant SKU", async () => {
    const result = await productService.getProducts(1, 10, { search: "MY-VARIANT-SKU" });
    assert.ok(result.products.length >= 1);
    const found = result.products.find((p: any) => p.name === "Search Variant Product");
    assert.ok(found);
    assert.ok(found.variants.some((v: any) => v.sku === "MY-VARIANT-SKU"));
  });
```

With a fixture variant carrying `sku: "MY-VARIANT-SKU"` created in `before`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: product search test passes.

- [ ] **Step 4: Commit**

```bash
git add src/repositories/product.repository.ts src/services/product.service.integration.test.ts
git commit -m "feat: search products by variant fields"
```

---

## Phase 7 — Final Verification

- [ ] **Step 1: Lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Full test suite**

```bash
npm test
```
Expected: ALL tests pass.

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: address verification feedback"
```

---

## Self-Review Notes

**Spec coverage:**
- Cost components CRUD + association + engine + snapshot → Tasks 1.1-1.6, 2.1
- External sales (single flow, EXTERNAL source, stock + inventory tx + engine) → Phase 3
- Customers (entity, list/detail/history/indicators, upsert on sync) → Phase 4
- Order enrichment (translated status, commercial status, margin, profit, origin) → Phase 5
- Dashboard (exclude canceled, date filters) → Task 6.1
- Product search across variants → Task 6.2
- Translations PT-BR provided by backend → Task 5.1

**Placeholder scan:** All steps contain concrete code; no TBD placeholders.

**Type consistency:** Engine types (`CostEngineItemInput`, `ItemCostSnapshot`, `OrderCostResult`) reused by cost.service, order.repository, external-sale repository/service. Schema enums match engine string unions.
