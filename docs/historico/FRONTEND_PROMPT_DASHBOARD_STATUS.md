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