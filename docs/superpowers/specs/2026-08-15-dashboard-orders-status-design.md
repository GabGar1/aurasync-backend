# Dashboard — Gráfico "Pedidos por Status" baseado em Fulfillment — Design Spec

Data: 2026-08-15 · Branch: `feat/cost-subgroup-linking` (base) · Escopo: **backend + prompt de frontend**

## Purpose

Corrigir o gráfico "Pedidos por Status" (`by_status` de `GET /api/dashboard/orders`). Hoje ele agrupa por `orders.status`, que concentra quase tudo em `PENDING` — dados reais: 1621/1825 pedidos. A tela/pedidos usa a distribuição real de `orders.fulfillment_status` (DELIVERED 1318, UNPACKED 205, MARKED_AS_FULFILLED 138, DISPATCHED 101, null 63).

O gráfico deve:
1. Agrupar por **`orders.fulfillment_status`** (NULL → `PENDING`).
2. Retornar cada fatia com **`status_label` já traduzido em PT-BR** para o front consumir direto.

## Decisões confirmadas com o usuário

1. Base do status = **fulfillment status** (não `orders.status`, não status efetivo por timestamps).
2. `fulfillment_status` NULL → agrupado como **`PENDING` / "Pendente"** (pedidos sem fulfillment ainda).
3. **Não aplicar mudanças no frontend** (`aurasync-admin-portal`). Backend implementa; mudanças de consumo documentadas em um prompt (handoff).
4. Pedidos cancelados continuam excluídos do gráfico (filtro `validOrderFilter` já exclui `orders.status = 'CANCELED'`).

## Contrato da rota (antes → depois)

`GET /api/dashboard/orders` (ADMIN/SUPER_ADMIN, autenticação).

`by_status` antes:
```json
[{ "status": "PENDING", "count": 1621 }, { "status": "DELIVERED", "count": 3 }]
```

`by_status` depois:
```json
[
  { "status": "DELIVERED", "status_label": "Entregue", "count": 1318 },
  { "status": "UNPACKED", "status_label": "Empacotando", "count": 205 },
  { "status": "MARKED_AS_FULFILLED", "status_label": "Marcado como Concluído", "count": 138 },
  { "status": "DISPATCHED", "status_label": "Despachado", "count": 101 },
  { "status": "PENDING", "status_label": "Pendente", "count": 63 }
]
```

Semanticamente: `status` = valor cru do fulfillment (fonte da verdade p/ cor/ícone), `status_label` = tradução pronta (fonte da verdade p/ exibição). Demais campos de `getOrdersStats` (`by_hour`, `top_products`, `revenue_trend`, etc.) inalterados.

## Mudanças no backend

### 1. `src/lib/order-status.ts`

Estender `FULFILLMENT_LABELS` com os valores de fulfillment observados na Nuvemshop (hoje retornam crus, sem tradução):

| Valor (DB) | Label |
|---|---|
| `UNPACKED` / `unpacked` | Empacotando |
| `DISPATCHED` / `dispatched` | Despachado |
| `MARKED_AS_FULFILLED` / `marked_as_fulfilled` | Marcado como Concluído |

`PENDING`/`pending`/`DELIVERED`/`SHIPPED`/`CANCELED` já existem. Nenhuma mudança de assinatura.

### 2. `src/repositories/dashboard.repository.ts` — `getOrdersStats`

Trocar o `byStatus` de agrupar por `status` para agrupar pela expressão coalescida:

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

`baseQuery` já tem `whereNull('orders.deleted_at')` e `where('orders.status', '<>', 'CANCELED')` — não muda. Usar `'PENDING'` (uppercase) como fallback mantém todas as chaves uniformes.

### 3. `src/services/dashboard.service.ts` — `getOrdersStats`

Após buscar os stats, traduzir `by_status`:

```ts
import { translateFulfillmentStatus } from "../lib/order-status.js";

async getOrdersStats(days = 30, dates = {}) {
  const stats = await dashboardRepository.getOrdersStats(days, dates);
  stats.by_status = stats.by_status.map((s) => ({
    ...s,
    status_label: translateFulfillmentStatus(s.status),
  }));
  return stats;
}
```

Tradução fica na camada de serviço (apresentação), não no repositório.

### 4. `src/schemas/dashboard.schema.ts`

`OrderStatusStats` ganha `status_label`:

```ts
export const OrderStatusStats = z.object({
  status: z.string(),
  status_label: z.string(),
  count: z.coerce.number().int(),
});
```

## Testes (TDD)

`src/services/dashboard.service.integration.test.ts`:

- **Ajustar seed**: o pedido de exemplo ganha `fulfillment_status: 'DELIVERED'`.
- **"should return order stats"**: `by_status` deve conter `{ status: 'DELIVERED', status_label: 'Entregue', count: 1 }` (substitui o assert de `status === 'PAID'`).
- **Novo teste — NULL → Pendente**: inserir pedido sem `fulfillment_status` (e `status` não-CANCELED) e assertar fatia `{ status: 'PENDING', status_label: 'Pendente', count: 1 }`.
- **"excludes CANCELED orders"**: mantém; o pedido CANCELED continua fora de `by_status` (o filtro exclui antes do agrupamento).

## Frontend (handoff — NÃO implementado aqui)

Entregar `docs/FRONTEND_PROMPT_DASHBOARD_STATUS.md` (padrão dos prompts existentes) explicando à rota consumida o que mudou:

- `GET /api/dashboard/orders` → `by_status` agora agrupa por fulfillment status; cada item tem `status` (cru) + `status_label` (PT-BR).
- Ajustes esperados no front: usar `status_label` no rótulo do gráfico; atualizar mapa de cores para chaves `DELIVERED`, `UNPACKED`, `DISPATCHED`, `MARKED_AS_FULFILLED`, `PENDING`; tipo `OrderStatusStats` ganha `status_label`.

## Suposições / limites

- Filtros temporais (`days`/`start_date`/`end_date`) e exclusão de cancelados continuam como estão.
- Valores de fulfillment são os crus da Nuvemshop (já vistos uppercase no DB); o mapa de tradução cobre os observados + variações minúsculas.

## Fora de escopo

- Qualquer mudança em `aurasync-admin-portal` (frontend).
- Re-trabalhar `orders.status` / `mapNuvemshopStatus` (causa raiz do acúmulo em PENDING) — separado desta mudança.
