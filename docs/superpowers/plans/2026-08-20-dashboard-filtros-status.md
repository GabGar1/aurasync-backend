# Dashboard: Filtros de Data, Campanha e fulfillment_status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o filtro de data do dashboard (dia único), agrupar campanhas sem `utm_campaign` por source/medium, excluir pedidos com sinais negativos (voided/refunded/cancelled) da receita e trocar o filtro de status por `fulfillment_status` na página de Pedidos.

**Architecture:** Backend: centralizar a validação de pedido válido em `validOrderFilter` (dashboard.repository.ts), reescrever `byCampaign` com subquery de CASE, robustecer `dateWindow` e adicionar filtro `fulfillment_status` em GET /orders. Frontend: `DateRangePicker` com seleção de dia único + estender para range + botão limpar; `MarketingSection` renderiza source/medium; `Orders.tsx` filtra por `fulfillment_status`.

**Tech Stack:** Node + TypeScript (ESM), Fastify 5, Knex (pg), Zod, node:test; frontend: React 18 + Vite, react-day-picker v8.10, react-query, vitest + @testing-library/react.

## Global Constraints

- TDD: todo comportamento novo começa com teste que falha (AGENTS.md).
- Testes backend: integration reais contra `aurasync_test` — `npm test` (nunca toca o dev DB).
- Testes que criam pedidos limpam SOMENTE seus próprios dados no `after` (nunca `db("orders").del()`).
- Sem comentários no código (convenção do repo).
- Backend: `src/lib/order-status.ts` já traduz `fulfillment_status` (valores: pending, shipped, delivered, cancelled, UNPACKED, unpacked, DISPATCHED, dispatched, MARKED_AS_FULFILLED, marked_as_fulfilled, PACKED/packed, PENDING/SHIPPED/DELIVERED/CANCELED).
- Dados reais: `payment_status` em {paid, voided, pending}; `fulfillment_status` em {DELIVERED, UNPACKED, MARKED_AS_FULFILLED, DISPATCHED, PACKED, null}.
- Repos: backend `/home/gabgar/dev/aurasync-backend` (branch develop), frontend `/home/gabgar/dev/aurasync-admin-portal` (branch develop).
- `validOrderFilter` aceita query builder de Knex (tipo `any`, padrão do arquivo).

---

### Task 1: Backend — receita exclui sinais negativos (voided/refunded/cancelled)

**Files:**
- Modify: `/home/gabgar/dev/aurasync-backend/src/repositories/dashboard.repository.ts:10-12` (validOrderFilter) e linhas 56-58, 74-76, 132-134, 246-247, 298-302 (filtros inline)
- Test: `/home/gabgar/dev/aurasync-backend/src/services/dashboard.service.integration.test.ts`

**Interfaces:**
- Produces: `validOrderFilter(query)` continua com a mesma assinatura (aceita Knex query builder e devolve o builder com filtros AND aplicados). Todas as queries do dashboard passam a usar a MESMA definição de "pedido válido".

- [ ] **Step 1: Escrever os testes que falham**

Adicionar no fim de `dashboard.service.integration.test.ts` (antes do `});` final do describe):

```ts
  it("excludes voided payment orders from revenue metrics", async () => {
    const voidedOrderId = "00000000-0000-0000-0000-000000000020";
    await db("orders").insert({
      id: voidedOrderId,
      customer_name: "Voided Customer",
      status: "PENDING",
      payment_status: "voided",
      fulfillment_status: "DELIVERED",
      total_amount: 500,
      created_at: new Date(),
    });
    await db("order_items").insert({
      order_id: voidedOrderId,
      variant_id: variantId,
      quantity: 1,
      unit_price: 500,
    });

    const result = await dashboardService.getOrdersStats(30);
    const delivered = result.by_status.find((s: any) => s.status === "DELIVERED");
    assert.strictEqual(delivered?.count, 1, "voided order must not appear in by_status");
    const top = result.top_products.find((p: any) => p.product_id === productId);
    assert.strictEqual(top?.total_sold, 2, "voided order must not count in top products");

    const marketing = await dashboardService.getMarketingStats(30);
    const web = marketing.by_storefront.find((s: any) => s.storefront === "web");
    assert.strictEqual(web?.revenue, 200, "voided order must not count in revenue");

    await db("order_items").where({ order_id: voidedOrderId }).del();
    await db("orders").where({ id: voidedOrderId }).del();
  });

  it("excludes cancelled fulfillment orders from metrics", async () => {
    const cancelledFulfillmentId = "00000000-0000-0000-0000-000000000021";
    await db("orders").insert({
      id: cancelledFulfillmentId,
      customer_name: "Cancelled Fulfillment",
      status: "PENDING",
      payment_status: "paid",
      fulfillment_status: "cancelled",
      total_amount: 300,
      created_at: new Date(),
    });

    const result = await dashboardService.getOrdersStats(30);
    const cancelled = result.by_status.find(
      (s: any) => s.status.toLowerCase() === "cancelled"
    );
    assert.strictEqual(cancelled, undefined, "cancelled fulfillment must be excluded");

    await db("orders").where({ id: cancelledFulfillmentId }).del();
  });
```

- [ ] **Step 2: Rodar os testes para ver falhar**

Run: `npm test -- --test-name-pattern="excludes"` (do diretório do backend)
Expected: FAIL — `delivered.count` é 2 (voided entra indevidamente), `top.total_sold` é 3, `web.revenue` é 700, e `cancelled` existe em by_status.

- [ ] **Step 3: Implementar o filtro centralizado**

Em `dashboard.repository.ts`, substituir a função `validOrderFilter` (linhas 10-12):

```ts
const NEGATIVE_STATUSES = ["CANCELED", "cancelled"];
const NEGATIVE_PAYMENT_STATUSES = ["voided", "refunded", "cancelled"];
const NEGATIVE_FULFILLMENT_STATUSES = ["cancelled", "CANCELED"];

function validOrderFilter(query: any) {
  return query
    .whereNull('orders.deleted_at')
    .whereNotIn('orders.status', NEGATIVE_STATUSES)
    .where(function (this: any) {
      this.whereNull('orders.payment_status').orWhereNotIn('orders.payment_status', NEGATIVE_PAYMENT_STATUSES);
    })
    .where(function (this: any) {
      this.whereNull('orders.fulfillment_status').orWhereNotIn('orders.fulfillment_status', NEGATIVE_FULFILLMENT_STATUSES);
    });
}
```

Aplicar o mesmo filtro onde hoje há filtros inline (substituir `.where("orders.status", "<>", "CANCELED").whereNull("orders.deleted_at")`):

- `getNoSales30d` (linhas 56-58): dentro do `whereNotIn`, trocar
  `.andWhere("orders.status", "<>", "CANCELED").whereNull("orders.deleted_at")` por `validOrderFilter(this)`
- `getTurnoverRate` (linhas 74-76): idem, `validOrderFilter(this)` (subquery `salesSubquery`)
- `getDeadStock` (linhas 132-134): idem, `validOrderFilter(this)`
- `topProducts` (linhas 246-247): trocar `.where("orders.status", "<>", "CANCELED").whereNull("orders.deleted_at")` por `validOrderFilter(db("orders").where("orders.id", "order_items.order_id"))` — **não**: topProducts já está num `.join("orders", ...)`; simplesmente chamar `validOrderFilter` encadeado funciona pois o builder já referencia `orders.*`:

```ts
const topProducts = await validOrderFilter(
  db("order_items")
    .join("product_variants", "product_variants.id", "order_items.variant_id")
    .join("products", "products.id", "product_variants.product_id")
    .join("orders", "orders.id", "order_items.order_id")
    .where("orders.created_at", ">=", start)
    .andWhere("orders.created_at", "<=", end)
    .whereNull("product_variants.deleted_at")
    .whereNull("products.deleted_at")
)
  .groupBy("products.id", "products.name", "products.category", "product_variants.name")
  .select(...) // mantém o select atual
```

- `repeatRow` (linhas 301-302): trocar `.where("orders.status", "<>", "CANCELED").whereNull("orders.deleted_at")` por `validOrderFilter(db("orders").where("orders.created_at", ">=", start).andWhere("orders.created_at", "<=", end))` e remover os `.where` duplicados do encadeamento original.

Atenção ao encadeamento: para `topProducts` e `repeatRow` o builder original começa em `db(...)` — a ordem dos `whereNull` não importa (AND). `validOrderFilter` pode ser chamado no builder completo, desde que ainda não tenha `.groupBy`/`.select`.

- [ ] **Step 4: Rodar os testes para passar**

Run: `npm test -- --test-name-pattern="excludes"` e depois `npm test`
Expected: PASS (testes novos + suite inteira do dashboard; `npm test` roda tudo serial).

- [ ] **Step 5: Commit**

```bash
git add src/repositories/dashboard.repository.ts src/services/dashboard.service.integration.test.ts
git commit -m "fix(dashboard): receita exclui pedidos voided/refunded/fulfillment cancelled"
```

---

### Task 2: Backend — by_campaign agrupa pedidos sem utm_campaign por source/medium

**Files:**
- Modify: `/home/gabgar/dev/aurasync-backend/src/repositories/dashboard.repository.ts:177-186`
- Modify: `/home/gabgar/dev/aurasync-backend/src/schemas/dashboard.schema.ts:61-66`
- Test: `/home/gabgar/dev/aurasync-backend/src/services/dashboard.service.integration.test.ts`

**Interfaces:**
- Produces: `CampaignStats` agora tem `{ campaign: string|null, source: string|null, medium: string|null, orders: int, revenue: number, aov: number }`. `by_campaign` do `getMarketingStats` devolve linhas em que: utm_campaign presente → `campaign`=utm_campaign, source/medium null; utm_campaign null + source/medium → `campaign` null, source/medium preenchidos; sem UTM nenhum → tudo null (frontend rotula "Orgânico/Direto").

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim do describe:

```ts
  it("by_campaign groups null utm_campaign orders by source/medium", async () => {
    const rows = [
      { id: "00000000-0000-0000-0000-000000000022", utm_campaign: null, utm_source: "ig", utm_medium: "social", total: 50 },
      { id: "00000000-0000-0000-0000-000000000023", utm_campaign: null, utm_source: "ig", utm_medium: "social", total: 30 },
      { id: "00000000-0000-0000-0000-000000000024", utm_campaign: null, utm_source: "IGShopping", utm_medium: "Social", total: 20 },
    ];
    for (const r of rows) {
      await db("orders").insert({
        id: r.id,
        customer_name: "Campaign Group",
        status: "PAID",
        utm_campaign: r.utm_campaign,
        utm_source: r.utm_source,
        utm_medium: r.utm_medium,
        total_amount: r.total,
        created_at: new Date(),
      });
    }

    const marketing = await dashboardService.getMarketingStats(30);
    const igRow = marketing.by_campaign.find(
      (c: any) => c.campaign === null && c.source === "ig" && c.medium === "social"
    );
    assert.ok(igRow, "ig/social group must exist");
    assert.strictEqual(igRow.orders, 2);
    assert.strictEqual(igRow.revenue, 80);

    const igShopRow = marketing.by_campaign.find(
      (c: any) => c.campaign === null && c.source === "IGShopping" && c.medium === "Social"
    );
    assert.ok(igShopRow, "IGShopping/Social group must exist");
    assert.strictEqual(igShopRow.orders, 1);

    const noUtmRow = marketing.by_campaign.find(
      (c: any) => c.campaign === null && c.source === null && c.medium === null
    );
    assert.ok(noUtmRow, "no-UTM group must exist");

    const summer = marketing.by_campaign.find((c: any) => c.campaign === "summer_sale");
    assert.ok(summer, "real campaign row must exist");
    assert.strictEqual(summer.source, null);

    await db("orders").whereIn("id", rows.map((r) => r.id)).del();
  });
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test -- --test-name-pattern="by_campaign groups"`
Expected: FAIL — `marketing.by_campaign` não tem campo `source` (agrupa tudo por utm_campaign; ig/social não é encontrado).

- [ ] **Step 3: Implementar**

Substituir o bloco `byCampaign` em `getMarketingStats` (linhas 177-186) por:

```ts
    const campaignSubquery = baseQuery
      .clone()
      .select(
        db.raw(`CASE WHEN orders.utm_campaign IS NOT NULL THEN orders.utm_campaign ELSE NULL END as campaign`),
        db.raw(`CASE WHEN orders.utm_campaign IS NULL THEN orders.utm_source ELSE NULL END as source`),
        db.raw(`CASE WHEN orders.utm_campaign IS NULL THEN orders.utm_medium ELSE NULL END as medium`),
        "orders.total_amount as total_amount"
      )
      .as("campaign_orders");

    const byCampaign = await db(campaignSubquery)
      .select(
        "campaign_orders.campaign as campaign",
        "campaign_orders.source as source",
        "campaign_orders.medium as medium",
        db.raw("COUNT(*)::int as orders"),
        db.raw("COALESCE(SUM(campaign_orders.total_amount), 0)::float8 as revenue"),
        db.raw("COALESCE(ROUND(AVG(campaign_orders.total_amount)::decimal, 2), 0)::float8 as aov")
      )
      .groupBy("campaign_orders.campaign", "campaign_orders.source", "campaign_orders.medium")
      .orderBy("orders", "desc");
```

Atualizar o schema `CampaignStats` em `dashboard.schema.ts:61-66`:

```ts
export const CampaignStats = z.object({
  campaign: z.string().nullable(),
  source: z.string().nullable(),
  medium: z.string().nullable(),
  orders: z.coerce.number().int(),
  revenue: z.coerce.number(),
  aov: z.coerce.number(),
});
```

- [ ] **Step 4: Rodar para passar**

Run: `npm test -- --test-name-pattern="by_campaign"` e depois `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/dashboard.repository.ts src/schemas/dashboard.schema.ts src/services/dashboard.service.integration.test.ts
git commit -m "feat(dashboard): by_campaign agrupa pedidos sem utm_campaign por source/medium"
```

---

### Task 3: Backend — dateWindow robusta (dia único, validação de formato)

**Files:**
- Modify: `/home/gabgar/dev/aurasync-backend/src/repositories/dashboard.repository.ts:14-25`
- Modify: `/home/gabgar/dev/aurasync-backend/src/routers/dashboard.router.ts:39-44, 71-76`
- Test: `/home/gabgar/dev/aurasync-backend/src/services/dashboard.service.integration.test.ts`

**Interfaces:**
- Produces: `dateWindow(days, dates)` aceita só `start_date` OU só `end_date` (janela = aquele dia inteiro em America/Sao_Paulo); lança `Error` se `end_date < start_date`. Router valida `YYYY-MM-DD` com regex.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim do describe:

```ts
  it("treats a single explicit start_date as a single day window", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await dashboardService.getMarketingStats(30, { start_date: tomorrow });
    assert.strictEqual(result.by_storefront.length, 0, "only start_date must not fall back to 30-day window");
  });

  it("rejects end_date before start_date", async () => {
    await assert.rejects(
      () => dashboardService.getMarketingStats(30, { start_date: "2026-08-10", end_date: "2026-08-01" }),
      /end_date/
    );
  });
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm test -- --test-name-pattern="single explicit|rejects end_date"`
Expected: FAIL — só `start_date` cai no sliding window de 30 dias (by_storefront não-vazio) e o segundo teste não rejeita.

- [ ] **Step 3: Implementar**

Substituir `dateWindow` (linhas 14-25):

```ts
  private dateWindow(days: number, dates: { start_date?: string; end_date?: string } = {}) {
    if (dates.start_date || dates.end_date) {
      const startDate = dates.start_date ?? dates.end_date!;
      const endDate = dates.end_date ?? dates.start_date!;
      const start = localDateToUtc(startDate);
      const end = localDateToUtc(endDate, true);
      if (end < start) {
        throw new Error("end_date cannot be before start_date");
      }
      return { start, end };
    }
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end };
  }
```

No router `dashboard.router.ts`, adicionar validação de formato (linhas 39-44 e 71-76):

```ts
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
```

- [ ] **Step 4: Rodar para passar**

Run: `npm test -- --test-name-pattern="date|explicit"` e depois `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/dashboard.repository.ts src/routers/dashboard.router.ts src/services/dashboard.service.integration.test.ts
git commit -m "fix(dashboard): dateWindow aceita dia único e valida formato/ordem das datas"
```

---

### Task 4: Backend — GET /orders filtra por fulfillment_status

**Files:**
- Modify: `/home/gabgar/dev/aurasync-backend/src/routers/order.router.ts:32-50`
- Modify: `/home/gabgar/dev/aurasync-backend/src/services/order.service.ts:90-96`
- Modify: `/home/gabgar/dev/aurasync-backend/src/repositories/order.repository.ts:536-547`
- Test: `/home/gabgar/dev/aurasync-backend/src/services/order.service.integration.test.ts`

**Interfaces:**
- Produces: `orderService.getOrders(page, limit, filters)` e `orderRepository.findAll(page, limit, filters)` aceitam `filters.fulfillment_status?: string` (em vez de `filters.status`). Valor case-insensitive; `pending` casa `fulfillment_status` null ou 'pending'. GET /orders aceita querystring `fulfillment_status`.

- [ ] **Step 1: Ler o arquivo de teste para seguir o padrão**

Run: `sed -n '1,80p' src/services/order.service.integration.test.ts`
Observar: IDs/emails usados no setup e como o `after` limpa dados próprios.

- [ ] **Step 2: Escrever o teste que falha**

Adicionar um teste que cria 3 pedidos com `fulfillment_status` diferentes (usando IDs fixos estilo `00000000-0000-0000-0000-0000000000XX`) e filtra:

```ts
  it("lists orders filtered by fulfillment_status (pending matches null)", async () => {
    const rows = [
      { id: "00000000-0000-0000-0000-000000000030", fulfillment_status: "DELIVERED", total: 10 },
      { id: "00000000-0000-0000-0000-000000000031", fulfillment_status: "unpacked", total: 20 },
      { id: "00000000-0000-0000-0000-000000000032", fulfillment_status: null, total: 30 },
    ];
    for (const r of rows) {
      await db("orders").insert({
        id: r.id,
        customer_name: "Fulfillment Filter Customer",
        status: "PAID",
        fulfillment_status: r.fulfillment_status,
        total_amount: r.total,
      });
    }

    const delivered = await orderService.getOrders(1, 10, { fulfillment_status: "DELIVERED" });
    assert.strictEqual(delivered.orders.length, 1);
    assert.strictEqual(delivered.orders[0]!.id, rows[0]!.id);

    const unpacked = await orderService.getOrders(1, 10, { fulfillment_status: "unpacked" });
    assert.strictEqual(unpacked.orders.length, 1);

    const pending = await orderService.getOrders(1, 10, { fulfillment_status: "pending" });
    const pendingIds = pending.orders.map((o: any) => o.id);
    assert.ok(pendingIds.includes(rows[2]!.id), "null fulfillment must match pending");

    await db("orders").whereIn("id", rows.map((r) => r.id)).del();
  });
```

(Ajustar os IDs/emails para não colidir com o setup do arquivo; conferir no Step 1.)

- [ ] **Step 3: Rodar para ver falhar**

Run: `npm test -- --test-name-pattern="fulfillment_status"`
Expected: FAIL — `filters.fulfillment_status` não existe na assinatura / filtro não aplica.

- [ ] **Step 4: Implementar**

`order.router.ts:32-50`:

```ts
  fastify.get('/', { onRequest: [fastify.authenticate], preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])], schema: { querystring: z.object({ page: z.coerce.number().optional(), limit: z.coerce.number().optional(), fulfillment_status: z.string().optional(), search: z.string().optional() }) } }, async (request, reply) => {
    try {
      const { page, limit, fulfillment_status, search } = request.query;

      const filters: { fulfillment_status?: string; search?: string } = {};
      if (fulfillment_status !== undefined) filters.fulfillment_status = fulfillment_status;
      if (search !== undefined) filters.search = search;

      const result = await orderService.getOrders(
        page ?? 1,
        limit ?? 10,
        filters
      );
```

`order.service.ts:90-96`: trocar a assinatura para `filters: { fulfillment_status?: string; search?: string } = {}`.

`order.repository.ts:536-547`:

```ts
  async findAll(
    page: number = 1,
    limit: number = 10,
    filters: { fulfillment_status?: string; search?: string } = {}
  ): Promise<{ orders: OrderWithItems[]; total: number; page: number; limit: number }> {
    let query = db(this.ordersTable)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    if (filters.fulfillment_status) {
      query = query.where(
        db.raw("COALESCE(LOWER(fulfillment_status), 'pending')"),
        filters.fulfillment_status.toLowerCase()
      );
    }
```

- [ ] **Step 5: Rodar para passar**

Run: `npm test -- --test-name-pattern="fulfillment_status"` e depois `npm test`
Expected: PASS. Conferir que `npm test` (suite completa) segue passando — pode haver teste de router existente usando `status` como query param; se houver, atualizar para `fulfillment_status` OU deixar `status` como alias opcional conforme necessário (decidir pelo resultado).

- [ ] **Step 6: Commit**

```bash
git add src/routers/order.router.ts src/services/order.service.ts src/repositories/order.repository.ts src/services/order.service.integration.test.ts
git commit -m "feat(orders): filtro por fulfillment_status no GET /orders"
```

---

### Task 5: Frontend — DateRangePicker com dia único, range e botão limpar

**Files:**
- Modify: `/home/gabgar/dev/aurasync-admin-portal/src/components/DateRangePicker.tsx`
- Test: Create `/home/gabgar/dev/aurasync-admin-portal/src/components/DateRangePicker.test.tsx`

**Interfaces:**
- Produces: `DateRangePicker` com comportamento: 1º clique comita `{from: X, to: X}` (dia único), 2º clique em dia diferente estende para range e fecha, 2º clique no mesmo dia confirma e fecha; botão "Limpar" comita `{from: null, to: null}`; label de dia único sem o traço.

- [ ] **Step 1: Escrever o teste que falha**

Criar `DateRangePicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateRangePicker, { DateRange } from '@/components/DateRangePicker';

describe('DateRangePicker', () => {
  it('commits a single day on first click and extends to a range on second click', () => {
    const onRangeChange = vi.fn();
    render(<DateRangePicker range={{ from: null, to: null }} onRangeChange={onRangeChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Selecionar período/i }));
    const day15 = screen.getByRole('button', { name: /15/i });
    fireEvent.click(day15);

    expect(onRangeChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) })
    );
    const firstCall = onRangeChange.mock.calls[0]![0] as DateRange;
    expect(firstCall.from!.getDate()).toBe(15);
    expect(firstCall.to!.getDate()).toBe(15);

    const day18 = screen.getByRole('button', { name: /18/i });
    fireEvent.click(day18);

    const secondCall = onRangeChange.mock.calls[1]![0] as DateRange;
    expect(secondCall.from!.getDate()).toBe(15);
    expect(secondCall.to!.getDate()).toBe(18);
  });

  it('clears the range with the Limpar button', () => {
    const onRangeChange = vi.fn();
    render(<DateRangePicker range={{ from: null, to: null }} onRangeChange={onRangeChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Selecionar período/i }));
    fireEvent.click(screen.getByRole('button', { name: /Limpar/i }));

    expect(onRangeChange).toHaveBeenCalledWith({ from: null, to: null });
  });
});
```

Observação: se o `aria-label` dos dias do react-day-picker v8 não casar com `/15/i`, ajustar o seletor usando `container.querySelectorAll('button[aria-label*="15"]')` ou semelhante (verificar no Step 2).

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run src/components/DateRangePicker.test.tsx` (do diretório do frontend)
Expected: FAIL (comportamento antigo não comita no 1º clique).

- [ ] **Step 3: Implementar**

Reescrever `DateRangePicker.tsx`:

```tsx
import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

interface Props {
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
}

const presets: { label: string; days: number }[] = [
  { label: '7 dias', days: 7 },
  { label: '15 dias', days: 15 },
  { label: '30 dias', days: 30 },
  { label: '60 dias', days: 60 },
  { label: '90 dias', days: 90 },
];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function DateRangePicker({ range, onRangeChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<Date | null>(null);

  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    onRangeChange({ from, to });
    setPendingStart(null);
    setOpen(false);
  }

  function handleSelect(selected: { from?: Date | null; to?: Date | null } | undefined) {
    if (!selected?.from) return;
    if (selected.from && selected.to) {
      onRangeChange({ from: selected.from, to: selected.to });
      setPendingStart(null);
      setOpen(false);
      return;
    }
    if (pendingStart && !sameDay(pendingStart, selected.from)) {
      const from = selected.from < pendingStart ? selected.from : pendingStart;
      const to = selected.from < pendingStart ? pendingStart : selected.from;
      onRangeChange({ from, to });
      setPendingStart(null);
      setOpen(false);
      return;
    }
    onRangeChange({ from: selected.from, to: selected.from });
    setPendingStart(selected.from);
  }

  const isSingleDay = range.from && range.to && sameDay(range.from, range.to);
  const label = range.from && range.to
    ? isSingleDay
      ? format(range.from, 'dd/MM/yyyy', { locale: ptBR })
      : `${format(range.from, 'dd/MM/yyyy', { locale: ptBR })} — ${format(range.to, 'dd/MM/yyyy', { locale: ptBR })}`
    : 'Selecionar período';

  const selectedValue = range.from && range.to
    ? { from: range.from, to: range.to }
    : pendingStart
      ? { from: pendingStart, to: pendingStart }
      : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start text-left font-normal w-[260px]', !range.from && !range.to && 'text-muted-foreground')}>
          <CalendarIcon className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex gap-1 p-2 border-b">
          {presets.map((preset) => (
            <Button key={preset.days} variant="ghost" size="sm" onClick={() => applyPreset(preset.days)}>
              {preset.label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => { onRangeChange({ from: null, to: null }); setPendingStart(null); setOpen(false); }}>
            <X className="h-3 w-3 mr-1" />
            Limpar
          </Button>
        </div>
        <Calendar
          mode="range"
          selected={selectedValue}
          onSelect={handleSelect}
          numberOfMonths={2}
          locale={ptBR}
        />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Rodar para passar**

Run: `npx vitest run src/components/DateRangePicker.test.tsx` e depois `npm test` (suite frontend)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/DateRangePicker.tsx src/components/DateRangePicker.test.tsx
git commit -m "feat(dashboard): seleção de dia único e botão limpar no filtro de data"
```

---

### Task 6: Frontend — MarketingSection renderiza source/medium nas campanhas

**Files:**
- Modify: `/home/gabgar/dev/aurasync-admin-portal/src/types/index.ts:254-259`
- Modify: `/home/gabgar/dev/aurasync-admin-portal/src/components/dashboard/MarketingSection.tsx:108-115`

**Interfaces:**
- Consumes: `CampaignStats` do backend com `source`/`medium`.
- Produces: `utmCampaignLabel(camp)` helper (ou inline) que retorna: `campaign`; ou `utmSourceLabel(source)` + `utmMediumLabel(medium)`; ou `'Orgânico/Direto'`.

- [ ] **Step 1: Atualizar o tipo**

`types/index.ts:254-259`:

```ts
export interface CampaignStats {
  campaign: string | null;
  source?: string | null;
  medium?: string | null;
  orders: number;
  revenue: number;
  aov: number;
}
```

- [ ] **Step 2: Atualizar o componente**

Em `MarketingSection.tsx`, adicionar um helper acima do componente:

```tsx
function utmCampaignLabel(camp: { campaign: string | null; source?: string | null; medium?: string | null }): string {
  if (camp.campaign) return camp.campaign;
  if (camp.source || camp.medium) {
    return [utmSourceLabel(camp.source), utmMediumLabel(camp.medium)].filter(Boolean).join(' / ');
  }
  return 'Orgânico/Direto';
}
```

Trocar a célula da tabela (linha 110):

```tsx
                        <TableCell>{utmCampaignLabel(camp)}</TableCell>
```

- [ ] **Step 3: Verificar**

Run: `npm run lint` e `npm run build` (frontend)
Expected: sem erros de tipo/lint.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/components/dashboard/MarketingSection.tsx
git commit -m "feat(dashboard): campanhas sem utm_campaign exibidas por origem (source/medium)"
```

---

### Task 7: Frontend — página de Pedidos filtra por fulfillment_status

**Files:**
- Modify: `/home/gabgar/dev/aurasync-admin-portal/src/services/api.ts:152-156`
- Modify: `/home/gabgar/dev/aurasync-admin-portal/src/pages/Orders.tsx:57, 65-66, 74-82, 160-175`

**Interfaces:**
- Consumes: `GET /orders?fulfillment_status=` (Task 4).
- Produces: filtro com opções `pending, unpacked, dispatched, delivered, marked_as_fulfilled, cancelled` (+ `all`). `useTableFilters<{ fulfillment_status: string }>()`.

- [ ] **Step 1: Atualizar api.ts**

```ts
  getAll: async (params?: { page?: number; limit?: number; fulfillment_status?: string; search?: string }): Promise<GetOrdersResponse> => {
```

- [ ] **Step 2: Atualizar Orders.tsx**

Linha 57 — trocar:

```ts
const orderStatuses = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELED'] as const;
```
por:
```ts
const fulfillmentFilterOptions: { value: string; label: string }[] = [
  { value: 'pending', label: 'Pendente' },
  { value: 'unpacked', label: 'Empacotando' },
  { value: 'dispatched', label: 'Despachado' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'marked_as_fulfilled', label: 'Marcado como Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
];
```

Linhas 65-66:

```ts
  const { page, limit, search, debouncedSearch, filter, setPage, changeSearch, changeLimit, changeFilter } = useTableFilters<{ fulfillment_status: string }>();
  const fulfillmentFilter = filter?.fulfillment_status ?? 'all';
```

Linhas 74-82:

```ts
  const { data, isLoading, isError, refetch } = useQuery<GetOrdersResponse>({
    queryKey: ['orders', page, limit, fulfillmentFilter, debouncedSearch],
    queryFn: () => ordersApi.getAll({
      page, limit,
      fulfillment_status: fulfillmentFilter !== 'all' ? fulfillmentFilter : undefined,
      search: debouncedSearch || undefined,
    }),
    placeholderData: (previousData) => previousData,
  });
```

Linhas 160-175:

```tsx
        <Select
          value={fulfillmentFilter}
          onValueChange={(value) => { changeFilter(value === 'all' ? undefined : { fulfillment_status: value }); }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar por Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Status</SelectItem>
            {fulfillmentFilterOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
```

- [ ] **Step 3: Verificar**

Run: `npm run lint` e `npm run build` (frontend)
Expected: sem erros. Conferir visualmente que o dropdown renderiza as opções de fulfillment.

- [ ] **Step 4: Commit**

```bash
git add src/services/api.ts src/pages/Orders.tsx
git commit -m "feat(orders): filtro de status usa fulfillment_status"
```

---

### Task 8: Verificação final

**Files:** nenhum (verificação).

- [ ] **Step 1: Backend**

Run: `npm test` (no backend)
Expected: suite inteira verde.

- [ ] **Step 2: Frontend**

Run: `npm test` e `npm run lint` (no frontend)
Expected: verde.

- [ ] **Step 3: Sanidade manual nos dados reais**

Run (prod DB):
```sql
SELECT COUNT(*) AS voided_not_cancelled,
       COALESCE(SUM(total_amount), 0) AS revenue
FROM orders
WHERE deleted_at IS NULL
  AND status <> 'CANCELED'
  AND payment_status = 'voided';
```
Expected: 3 pedidos / R$ 625,15 (serão excluídos da receita do dashboard).

- [ ] **Step 4: Status final**

Run: `git status` nos dois repos — confirmar que não há mudanças não commitadas.
