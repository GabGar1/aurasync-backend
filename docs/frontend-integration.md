# Frontend Integration — API Response Changes

> **Last updated:** 2026-07-25
> **Branch:** `feat/enrich-dashboard-data`

## What Changed

The `GET /orders` and `GET /orders/:id` responses now include **21 new fields** extracted from Nuvemshop. The product variant responses now include **4 new dimension fields**.

All new fields are **nullable** (`null` = not available). Existing orders and products (created before this migration) will return `null` for every new field.

## Orders — Priority 1 (Display in Frontend)

Show these fields in the order list and order detail views.

| Campo | Tipo | Onde mostrar | Exemplo |
|---|---|---|---|
| `discount_amount` | `number \| null` | Resumo financeiro do pedido | `R$ 49,40` |
| `paid_at` | `string \| null` | Timeline do pedido (data real de pagamento) | `2026-05-13T17:49:03+0000` |
| `shipped_at` | `string \| null` | Timeline — quando foi enviado | `2026-05-15T10:00:00+0000` |
| `completed_at` | `string \| null` | Timeline — quando foi entregue | `2026-05-20T14:30:00+0000` |
| `cancelled_at` | `string \| null` | Timeline — se cancelado | `2026-05-13T18:00:00+0000` |
| `payment_method` | `string \| null` | Card de pagamento | `"credit_card"` → "Cartão de Crédito" |
| `payment_installments` | `number \| null` | Ao lado do método | `3` → "3x" |
| `shipping_cost_customer` | `number \| null` | Linha de frete no resumo | `25.36` |
| `shipping_city` | `string \| null` | Endereço de entrega | `"Belo Horizonte"` |
| `shipping_province` | `string \| null` | Estado | `"Minas Gerais"` |
| `shipping_carrier` | `string \| null` | Transportadora | `"Nuvem Envio"` |
| `customer_email` | `string \| null` | Contato do cliente | `ninicksacf@gmail.com` |
| `storefront` | `string \| null` | Badge no card do pedido | `"mobile"` → ícone de celular |

### Suggested UI: Order timeline

```
[Pago 13/05 14:49] → [Enviado 15/05] → [Entregue 20/05]
```

Use `paid_at`, `shipped_at`, `completed_at` em vez de `created_at` (que é a data de sincronização no servidor, não a data real do pedido).

### Suggested UI: Totals breakdown

```
Subtotal:     R$ 149,70  (se disponível, ou calcular dos itens)
Desconto:    -R$  49,40
Frete:       +R$  25,36
Total:        R$ 125,66
Pagamento:    Cartão de Crédito Elo | 3x
```

### Payment method mapping

```ts
const paymentLabels: Record<string, string> = {
  credit_card: "Cartão de Crédito",
  debit_card: "Cartão de Débito",
  pix: "PIX",
  boleto: "Boleto",
  nuvem_pago: "Nuvem Pago",
};
```

## Orders — Priority 2 (Dashboard / Analytics Only)

These fields exist in the API response for query/aggregation purposes but should **not** be displayed in individual order cards or detail views.

| Campo | Uso no dashboard |
|---|---|
| `shipping_cost_owner` | Custo real do frete pago pela loja — margem de frete |
| `gateway` | Análise de taxas por gateway |
| `utm_source` | Atribuição de marketing |
| `utm_medium` | Canal (paid / organic / social) |
| `utm_campaign` | Nome da campanha |
| `utm_content` | Criativo do anúncio |
| `utm_term` | Palavra-chave |

**Regra:** Se 7 colunas de dados de analytics ocupam espaço em um card de pedido e o operador **nunca** toma decisão olhando um pedido individual, omita do componente de listagem/detalhe. Eles existem para queries agregadas: `GET /orders?utm_source=ig&utm_medium=paid`.

## Products — Variant Dimensions

Show these in the product variant card, alongside SKU and price.

| Campo | Tipo | Onde mostrar |
|---|---|---|
| `weight` | `number \| null` | Especificações (kg) |
| `height` | `number \| null` | Dimensões (cm) |
| `width` | `number \| null` | Dimensões (cm) |
| `depth` | `number \| null` | Dimensões (cm) |

If all four are `null`, render nothing. If some are present, show as:

```text
Peso: 0.250 kg
Dimensões: 15 × 9 × 23 cm (L × A × P)
```

## TypeScript Types

```ts
interface Order {
  // --- existing ---
  id: string;
  nuvemshop_order_id: string | null;
  customer_name: string | null;
  status: "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELED";
  total_amount: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];

  // --- new — Priority 1 (display in UI) ---
  discount_amount: number | null;
  shipping_cost_customer: number | null;
  paid_at: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  payment_method: string | null;
  payment_installments: number | null;
  shipping_city: string | null;
  shipping_province: string | null;
  shipping_carrier: string | null;
  customer_email: string | null;
  storefront: string | null;

  // --- new — Priority 2 (analytics, available via API but not for display) ---
  shipping_cost_owner: number | null;
  gateway: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

interface ProductVariant {
  // --- existing ---
  id: string;
  product_id: string;
  sku: string | null;
  name: string | null;
  price: number;
  stock_quantity: number;
  cost_price: number;
  packaging_cost: number;
  platform_fee_percent: number;
  fixed_fee: number;

  // --- new ---
  weight: number | null;
  height: number | null;
  width: number | null;
  depth: number | null;
}
```

## Example API Response (Order Detail)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "nuvemshop_order_id": "1969442650",
  "customer_name": "Aline Costa Fernandes",
  "customer_email": "ninicksacf@gmail.com",
  "status": "PAID",
  "total_amount": 125.66,
  "discount_amount": 49.40,
  "shipping_cost_customer": 25.36,
  "shipping_cost_owner": 25.36,
  "paid_at": "2026-05-13T17:49:03.000Z",
  "shipped_at": null,
  "completed_at": "2026-05-13T17:49:00.000Z",
  "cancelled_at": null,
  "payment_method": "credit_card",
  "payment_installments": 3,
  "gateway": "nuvem-pago",
  "shipping_city": "Belo Horizonte",
  "shipping_province": "Minas Gerais",
  "shipping_carrier": "Nuvem Envio",
  "storefront": "mobile",
  "utm_source": "ig",
  "utm_medium": "paid",
  "utm_campaign": "120222198954390582",
  "utm_content": "120240092594690582",
  "utm_term": "120240092594710582",
  "items": [
    {
      "variant_id": "uuid",
      "quantity": 2,
      "unit_price": 49.90,
      "unit_cost": 0,
      "unit_packaging_cost": 0,
      "unit_platform_fee": 0
    }
  ],
  "created_at": "2026-05-13T17:49:04.000Z",
  "updated_at": "2026-05-13T17:49:04.000Z"
}
```

## API Endpoints

| Method | Path | New fields included |
|---|---|---|
| `GET` | `/api/orders` | Yes — full list response |
| `GET` | `/api/orders/:id` | Yes — full order detail |
| `GET` | `/api/products` | Yes — variants include dimensions |
| `GET` | `/api/products/:id` | Yes — variants include dimensions |

No new endpoints were created. All new fields are included in existing responses.
