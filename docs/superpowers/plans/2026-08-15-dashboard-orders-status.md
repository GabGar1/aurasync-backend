# Dashboard "Pedidos por Status" — Fulfillment traduzido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o gráfico "Pedidos por Status" de `GET /api/dashboard/orders` agrupar por `orders.fulfillment_status` (NULL → `PENDING`) e retornar cada fatia com `status_label` já traduzido em PT-BR. Backend apenas; o frontend consome via prompt de handoff.

**Architecture:** O repositório agrupa pela expressão `COALESCE(orders.fulfillment_status, 'PENDING')`; o serviço enriquece cada fatia com `status_label` via `translateFulfillmentStatus` (mapa estendido); o schema da resposta documenta o novo campo; o prompt de frontend (`docs/FRONTEND_PROMPT_DASHBOARD_STATUS.md`) explica a mudança de contrato.

**Tech Stack:** Node + TypeScript (ESM), Knex, Zod, `node:test` (integração real contra `aurasync_test`).

## Global Constraints

- TDD: escrever o teste que falha antes de implementar (AGENTS.md).
- Arquitetura estrita: Router → Service → Repository. Tradução fica no Service (apresentação), nunca no SQL/repositório.
- Soft delete / filtros existentes: `by_status` continua sob o filtro `validOrderFilter` (`deleted_at IS NULL` e `status <> 'CANCELED'`).
- Regra decimal/cents não se aplica (não mexe em valores monetários).
- Não alterar nada em `aurasync-admin-portal` (frontend).
- Comandos de verificação: `npm run lint` e `npx tsc --noEmit`. Atenção: `tsc --noEmit` já tem erros **pré-existentes** em arquivos WIP de outra sessão (`cost.service.integration.test.ts`, `order.service.integration.test.ts`, `product-subgroup.service.integration.test.ts`) — o critério é NÃO introduzir erros novos nos arquivos tocados por este plano.

---

### Task 1: Teste de integração falha (TDD) — `by_status` por fulfillment

**Files:**
- Modify: `src/services/dashboard.service.integration.test.ts:36-49` (seed do pedido) e `:112-137` (teste "should return order stats") e adicionar teste novo.
- Test: o mesmo arquivo.

**Interfaces:**
- Produces: o contrato esperado de `by_status` → `Array<{ status: string; status_label: string; count: number }>` retornado por `dashboardService.getOrdersStats(days, dates)`.

- [ ] **Step 1: Atualizar o seed com `fulfillment_status`**

No objeto de insert de `orders` (linhas ~36-49), adicionar `fulfillment_status: "DELIVERED",`:

```ts
    await db("orders").insert({
      id: orderId,
      customer_name: "Test Customer",
      status: "PAID",
      fulfillment_status: "DELIVERED",
      total_amount: 200.00,
      storefront: "web",
      shipping_province: "SP",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "summer_sale",
      payment_method: "credit_card",
      customer_email: "customer@test.com",
      created_at: new Date(),
    });
```

- [ ] **Step 2: Atualizar o assert do "should return order stats"**

Trocar o bloco de `by_status` (linhas ~129-132):

```ts
    assert.ok(Array.isArray(result.by_status));
    const paid = result.by_status.find((s) => s.status === "PAID");
    assert.ok(paid);
    assert.strictEqual(paid.count, 1);
```

por:

```ts
    assert.ok(Array.isArray(result.by_status));
    const delivered = result.by_status.find((s) => s.status === "DELIVERED");
    assert.ok(delivered);
    assert.strictEqual(delivered.count, 1);
    assert.strictEqual(delivered.status_label, "Entregue");
```

- [ ] **Step 3: Adicionar teste novo de tradução + NULL → Pendente**

Inserir, logo após o teste "should return order stats" (antes do "includes product category on top products"), o seguinte `it`:

```ts
  it("by_status groups by fulfillment status with translated labels (NULL -> Pendente)", async () => {
    const statuses = [
      { id: "00000000-0000-0000-0000-000000000010", fulfillment_status: "UNPACKED" },
      { id: "00000000-0000-0000-0000-000000000011", fulfillment_status: "DISPATCHED" },
      { id: "00000000-0000-0000-0000-000000000012", fulfillment_status: "MARKED_AS_FULFILLED" },
      { id: "00000000-0000-0000-0000-000000000013", fulfillment_status: null },
    ];
    for (const s of statuses) {
      await db("orders").insert({
        id: s.id,
        customer_name: "Fulfillment Customer",
        status: "PAID",
        fulfillment_status: s.fulfillment_status,
        total_amount: 100.00,
        created_at: new Date(),
      });
    }

    const result = await dashboardService.getOrdersStats(30);
    const labels: Record<string, string> = {
      UNPACKED: "Empacotando",
      DISPATCHED: "Despachado",
      MARKED_AS_FULFILLED: "Marcado como Concluído",
      PENDING: "Pendente",
    };
    for (const [status, label] of Object.entries(labels)) {
      const row = result.by_status.find((s: any) => s.status === status);
      assert.ok(row, `missing by_status row for ${status}`);
      assert.strictEqual(row.status_label, label);
    }
    assert.strictEqual(
      result.by_status.find((s: any) => s.status === "UNPACKED").count,
      1
    );
    assert.strictEqual(
      result.by_status.find((s: any) => s.status === "DISPATCHED").count,
      1
    );
    assert.strictEqual(
      result.by_status.find((s: any) => s.status === "MARKED_AS_FULFILLED").count,
      1
    );
  });
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

```bash
npm run pretest >/dev/null 2>&1; NODE_ENV=test node --import tsx --test src/services/dashboard.service.integration.test.ts
```

Expected: FALHA — "should return order stats" e o teste novo falham (`status_label` é `undefined` e não existe fatia `DELIVERED`, pois `by_status` ainda agrupa por `status` → `PAID`).

### Task 2: Implementar repositório, serviço e schema

**Files:**
- Modify: `src/repositories/dashboard.repository.ts:282-286` (`byStatus` em `getOrdersStats`)
- Modify: `src/services/dashboard.service.ts:1` (import) e `:27-29` (`getOrdersStats`)
- Modify: `src/lib/order-status.ts:27-36` (`FULFILLMENT_LABELS`)
- Modify: `src/schemas/dashboard.schema.ts:110-113` (`OrderStatusStats`)

**Interfaces:**
- Consumes: `translateFulfillmentStatus(status: string | null | undefined): string` (assinatura já existente em `order-status.ts`).
- Produces: `by_status` do repositório → `Array<{ status: string; count: number }>` (chaves uppercase, `PENDING` para NULL); serviço → `Array<{ status: string; status_label: string; count: number }>`.

- [ ] **Step 5: Escrever o teste unitário do mapa de tradução (novo arquivo)**

Criar `src/lib/order-status.unit.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { translateFulfillmentStatus } from "./order-status.js";

describe("translateFulfillmentStatus", () => {
  it("translates Nuvemshop fulfillment values to PT-BR", () => {
    assert.strictEqual(translateFulfillmentStatus("DELIVERED"), "Entregue");
    assert.strictEqual(translateFulfillmentStatus("UNPACKED"), "Empacotando");
    assert.strictEqual(translateFulfillmentStatus("DISPATCHED"), "Despachado");
    assert.strictEqual(
      translateFulfillmentStatus("MARKED_AS_FULFILLED"),
      "Marcado como Concluído"
    );
    assert.strictEqual(translateFulfillmentStatus("pending"), "Pendente");
    assert.strictEqual(translateFulfillmentStatus("PENDING"), "Pendente");
    assert.strictEqual(translateFulfillmentStatus(null), "Sem status");
  });
});
```

- [ ] **Step 6: Rodar o teste unitário e confirmar que falha**

```bash
NODE_ENV=test node --import tsx --test src/lib/order-status.unit.test.ts
```

Expected: FALHA em `UNPACKED`/`DISPATCHED`/`MARKED_AS_FULFILLED` (retornam o valor cru).

- [ ] **Step 7: Estender `FULFILLMENT_LABELS`**

Em `src/lib/order-status.ts`, substituir o bloco:

```ts
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
```

por:

```ts
const FULFILLMENT_LABELS: Record<string, string> = {
  pending: 'Pendente',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  PENDING: 'Pendente',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelado',
  UNPACKED: 'Empacotando',
  unpacked: 'Empacotando',
  DISPATCHED: 'Despachado',
  dispatched: 'Despachado',
  MARKED_AS_FULFILLED: 'Marcado como Concluído',
  marked_as_fulfilled: 'Marcado como Concluído',
};
```

- [ ] **Step 8: Rodar o teste unitário e confirmar que passa**

```bash
NODE_ENV=test node --import tsx --test src/lib/order-status.unit.test.ts
```

Expected: PASS (7/7).

- [ ] **Step 9: Alterar a query `byStatus` no repositório**

Em `src/repositories/dashboard.repository.ts`, dentro de `getOrdersStats`, substituir:

```ts
    const byStatus = await baseQuery
      .clone()
      .groupBy("status")
      .select("status", db.raw("COUNT(*)::int as count"))
      .orderBy("count", "desc");
```

por:

```ts
    const byStatus = await baseQuery
      .clone()
      .groupBy(db.raw("COALESCE(orders.fulfillment_status, 'PENDING')"))
      .select(
        db.raw("COALESCE(orders.fulfillment_status, 'PENDING') as status"),
        db.raw("COUNT(*)::int as count")
      )
      .orderBy("count", "desc");
```

- [ ] **Step 10: Traduzir no serviço**

Em `src/services/dashboard.service.ts`:

Import no topo (junto ao import do repositório):

```ts
import { translateFulfillmentStatus } from "../lib/order-status.js";
```

Substituir `getOrdersStats`:

```ts
  async getOrdersStats(days = 30, dates: { start_date?: string; end_date?: string } = {}) {
    const stats = await dashboardRepository.getOrdersStats(days, dates);
    stats.by_status = stats.by_status.map((s: any) => ({
      ...s,
      status_label: translateFulfillmentStatus(s.status),
    }));
    return stats;
  }
```

- [ ] **Step 11: Atualizar o schema da resposta**

Em `src/schemas/dashboard.schema.ts`, substituir:

```ts
export const OrderStatusStats = z.object({
  status: z.string(),
  count: z.coerce.number().int(),
});
```

por:

```ts
export const OrderStatusStats = z.object({
  status: z.string(),
  status_label: z.string(),
  count: z.coerce.number().int(),
});
```

- [ ] **Step 12: Rodar o teste de integração e confirmar que passa**

```bash
NODE_ENV=test node --import tsx --test src/services/dashboard.service.integration.test.ts
```

Expected: PASS — "should return order stats" e o teste novo de tradução passam (fatias `DELIVERED`/`UNPACKED`/`DISPATCHED`/`MARKED_AS_FULFILLED`/`PENDING` com labels corretos).

- [ ] **Step 13: Rodar suíte completa + lint + typecheck**

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: `npm test` verde (108+ testes, incluindo o novo unit test). Lint sem erros nos arquivos tocados. `tsc` sem **erros novos** (erros pré-existentes em WIP de outra sessão são tolerados).

- [ ] **Step 14: Commit**

```bash
git add src/lib/order-status.ts src/lib/order-status.unit.test.ts src/repositories/dashboard.repository.ts src/services/dashboard.service.ts src/schemas/dashboard.schema.ts src/services/dashboard.service.integration.test.ts
git commit -m "feat(dashboard): orders-by-status chart grouped by fulfillment status with PT-BR labels"
```

### Task 3: Prompt de frontend (handoff da rota consumida)

**Files:**
- Create: `docs/FRONTEND_PROMPT_DASHBOARD_STATUS.md`

**Interfaces:**
- Produces: documentação do contrato de `GET /api/dashboard/orders` → `by_status` para o time de frontend consumir.

- [ ] **Step 15: Escrever o prompt de frontend**

Criar `docs/FRONTEND_PROMPT_DASHBOARD_STATUS.md`:

```markdown
# Frontend — Mudança em `GET /api/dashboard/orders` → `by_status`

Data: 2026-08-15 · Referente ao gráfico "Pedidos por Status" do Dashboard.

## O que mudou

O `by_status` da rota `GET /api/dashboard/orders` (autenticada, ADMIN/SUPER_ADMIN)
não agrupa mais por `orders.status` (que concentrava quase tudo em "Pendente").
Agora agrupa por **`orders.fulfillment_status`** (status de cumprimento do pedido),
com pedidos sem fulfillment agrupados como `PENDING`.

Cada item da lista agora traz **`status_label` já traduzido em PT-BR**:

```json
[
  { "status": "DELIVERED",           "status_label": "Entregue",                "count": 1318 },
  { "status": "UNPACKED",            "status_label": "Empacotando",             "count": 205 },
  { "status": "MARKED_AS_FULFILLED", "status_label": "Marcado como Concluído",  "count": 138 },
  { "status": "DISPATCHED",          "status_label": "Despachado",              "count": 101 },
  { "status": "PENDING",             "status_label": "Pendente",                "count": 63 }
]
```

> Valores acima são ilustrativos da distribuição atual, não constantes.

Semântica dos campos:
- `status` — valor cru do fulfillment (fonte da verdade para cor/ícone, chave única).
- `status_label` — tradução pronta (fonte da verdade para exibição).
- `count` — nº de pedidos na fatia (cancelados continuam excluídos).

## Ajustes esperados no front

1. **Rótulo do gráfico**: usar `status_label` em vez de `statusLabel(status)` local
   (Pie `OrdersCharts.tsx`).
2. **Cores**: atualizar o mapa de cores do pie para as chaves
   `DELIVERED`, `UNPACKED`, `DISPATCHED`, `MARKED_AS_FULFILLED`, `PENDING`
   (as chaves atuais `open/paid/shipped/closed/cancelled` não ocorrem mais aqui).
3. **Tipo**: `OrderStatusStats` ganha `status_label: string` (opcional para
   compatibilidade) em `types/index.ts`.

Nenhum outro campo de `GET /api/dashboard/orders` mudou.
```

- [ ] **Step 16: Commit**

```bash
git add docs/FRONTEND_PROMPT_DASHBOARD_STATUS.md
git commit -m "docs: frontend prompt for dashboard orders-by-status route change"
```

### Task 4: Verificação final

- [ ] **Step 17: Suíte completa + status do repositório**

```bash
npm test
npm run lint
git status --short
```

Expected: suíte verde; lint ok; `git status` limpo (sem alterações não commitadas além das pré-existentes da sessão anterior, que **não** devem ser commitadas neste branch).
