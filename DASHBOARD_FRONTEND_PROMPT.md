# AuraSync Dashboard — Frontend Implementation Prompt

## Backend Context

| Item | Detail |
|------|--------|
| **Base URL** | `http://localhost:3333/api` (dev) |
| **Auth** | JWT Bearer token, 2h expiry |
| **Login** | `POST /api/login` → `{ token: string, user: { id, email, first_name, last_name, role } }` |
| **Auth header** | `Authorization: Bearer <token>` |
| **Error shape** | `{ error: string }` — 401 on expired/invalid token, 500 on server errors |
| **WS** | `ws://localhost:3333` — events: `products_updated`, `orders_updated` |

## Interaction Rules

- Poll all 4 dashboard endpoints every **60 seconds** using `setInterval`.
- On receiving a WebSocket `products_updated` or `orders_updated` event, trigger an **immediate refetch** of all dashboard endpoints (reset the interval).
- **All dashboard endpoints** accept date range params. `users/stats` is the only exception (no date filtering).
- **All date filtering uses `orders.completed_at`** — dashboard metrics reflect **completed** orders only (when the purchase was finalized), not when the order was created.

### Date Range Query Parameters

All 3 dashboard endpoints (`orders`, `marketing`, `stock`) accept:

| Param | Type | Description |
|-------|------|-------------|
| `days` | `number` | Sliding window (e.g. `30` = last 30 days). Default: `30`. |
| `startDate` | `string` (ISO) | Explicit range start (e.g. `2026-06-01`). Mutually exclusive with `days`. |
| `endDate` | `string` (ISO) | Explicit range end (e.g. `2026-06-30`). Required if `startDate` is set. |

When `startDate`/`endDate` are provided, `days` is ignored. When neither is provided, defaults to `days=30`.

**Examples:**
- `GET /api/dashboard/orders?days=60` — last 60 days of completed orders
- `GET /api/dashboard/marketing?startDate=2026-06-01&endDate=2026-06-30` — June marketing data
- `GET /api/dashboard/stock?startDate=2026-01-01&endDate=2026-07-26` — stock health in a custom range

## Tech Stack

- **shadcn/ui** — already in the project (Table, Card, Badge, Skeleton, etc.)
- **recharts** — install if needed (`npm install recharts`). Use `<ResponsiveContainer>` for chart sizing.

---

## Card 1 — Revenue KPI Row

**Endpoint:** `GET /api/dashboard/orders?days=30`
**Response path:** `.average_order_value`, `.revenue_trend`
**TypeScript:**

```ts
type OrderDashboard = {
  average_order_value: number;
  revenue_trend: Array<{ date: string; revenue: number; orders: number }>;
  by_status: Array<{ status: string; count: number }>;
  by_hour: Array<{ hour: number; orders: number; revenue: number }>;
  top_products: Array<{ product_id: string; product_name: string; variant_name: string | null; total_sold: number; revenue: number }>;
  repeat_customers: { unique_customers: number; repeat_customers: number; repeat_rate: number };
};
```

**Viz:** Row of stat cards showing:
- AOV (formatted as currency, e.g. `R$ XX,XX`)
- Total revenue for period (sum `revenue_trend[].revenue`)
- Total orders for period (sum `revenue_trend[].orders`)
- Revenue trend sparkline (mini line chart from `revenue_trend[]` data, last 30 points)

---

## Card 2 — Revenue Trend Chart

**Endpoint:** `GET /api/dashboard/orders?days=30`
**Response path:** `.revenue_trend`
**TypeScript:** Same as Card 1

**Viz:** Full-width line/area chart using recharts `<AreaChart>`. X-axis: dates, Y-axis: revenue. Optionally overlay a bar series for `orders` count on secondary Y-axis.

---

## Card 3 — Orders by Hour

**Endpoint:** `GET /api/dashboard/orders?days=30`
**Response path:** `.by_hour`

**Viz:** Bar chart (recharts `<BarChart>`), X-axis: hours 0-23, Y-axis: order count. Highlight the busiest hour with a different color. Data is based on `completed_at` — shows the hour customers most often complete their purchase.

---

## Card 4 — Orders by Status

**Endpoint:** `GET /api/dashboard/orders?days=30`
**Response path:** `.by_status`

**Viz:** Donut/pie chart (recharts `<PieChart>`) or horizontal stacked bar. Statuses map to colors:
- `PAID` → blue
- `PENDING` → amber
- `SHIPPED` → cyan
- `DELIVERED` → green
- `CANCELED` → red

---

## Card 5 — Top 20 Products

**Endpoint:** `GET /api/dashboard/orders?days=30`
**Response path:** `.top_products`

**Viz:** shadcn/ui `<Table>` sorted by `total_sold` descending (already sorted by API). Columns: Product name, Variant name, Units sold, Revenue (formatted currency).

---

## Card 6 — Repeat Customer Rate

**Endpoint:** `GET /api/dashboard/orders?days=30`
**Response path:** `.repeat_customers`

**Viz:** Stat card showing:
- Total unique customers
- Repeat customers
- Repeat rate as a percentage badge (e.g. `<Badge variant={rate > 30 ? 'success' : 'default'}>`)
- Optional: progress bar showing repeat_rate%

---

## Card 7 — Marketing: Storefronts

**Endpoint:** `GET /api/dashboard/marketing?days=30`
**Response path:** `.by_storefront`
**TypeScript:**

```ts
type MarketingDashboard = {
  by_storefront: Array<{ storefront: string | null; orders: number; revenue: number }>;
  by_province: Array<{ province: string | null; orders: number; revenue: number }>;
  by_campaign: Array<{ campaign: string | null; orders: number; revenue: number; aov: number }>;
  by_source: Array<{ source: string | null; medium: string | null; orders: number; revenue: number }>;
  by_payment_method: Array<{ method: string | null; orders: number; revenue: number }>;
};
```

**Viz:** Horizontal bar chart (recharts `<BarChart layout="vertical">`). Bar = `orders`, label = `storefront`. Revenue displayed as tooltip.

---

## Card 8 — Marketing: Provinces

**Endpoint:** `GET /api/dashboard/marketing?days=30`
**Response path:** `.by_province`

**Viz:** shadcn/ui `<Table>` sorted by `orders` descending. Columns: Province, Orders, Revenue (formatted).

---

## Card 9 — Marketing: Campaigns

**Endpoint:** `GET /api/dashboard/marketing?days=30`
**Response path:** `.by_campaign`

**Viz:** shadcn/ui `<Table>`. Columns: Campaign, Orders, Revenue, AOV (formatted currency). Highlight campaigns where AOV > overall AOV.

---

## Card 10 — Marketing: UTM Sources

**Endpoint:** `GET /api/dashboard/marketing?days=30`
**Response path:** `.by_source`

**Viz:** shadcn/ui `<Table>`. Columns: Source, Medium, Orders, Revenue. Group visually by `source` (or just sort by revenue desc).

---

## Card 11 — Marketing: Payment Methods

**Endpoint:** `GET /api/dashboard/marketing?days=30`
**Response path:** `.by_payment_method`

**Viz:** Donut chart (recharts `<PieChart>`) or compact horizontal bar chart. Slice = payment method name, value = `orders`.

---

## Card 12 — Low Stock Alerts

**Endpoint:** `GET /api/dashboard/stock`
**Response path:** `.low_stock`
**TypeScript:**

```ts
type StockDashboard = {
  low_stock: Array<{ product_id: string; product_name: string; variant_name: string | null; sku: string | null; stock: number }>;
  no_sales_30d: Array<{ product_id: string; product_name: string; variant_name: string | null; stock: number }>;
  turnover_rate: Array<{ product_id: string; product_name: string; variant_name: string | null; sales_qty_30d: number; avg_stock: number; turnover: number }>;
  stock_value_by_category: Array<{ category: string | null; total_value: number; variant_count: number }>;
  dead_stock: Array<{ product_id: string; product_name: string; variant_name: string | null; stock: number; days_without_sale: number }>;
};
```

**Viz:** Warning-styled card. shadcn/ui `<Table>` with a red/amber `<Badge>` for `stock` value when <= 5. Columns: Product, Variant, SKU, Stock. If `low_stock` length === 0, show a green "All stock healthy" badge.

---

## Card 13 — Stock with No Sales (30 days)

**Endpoint:** `GET /api/dashboard/stock`
**Response path:** `.no_sales_30d`

**Viz:** shadcn/ui `<Table>`. Columns: Product, Variant, Current Stock. Warn if stock is high but no sales.

---

## Card 14 — Turnover Rates

**Endpoint:** `GET /api/dashboard/stock`
**Response path:** `.turnover_rate`

**Viz:** Sortable shadcn/ui `<Table>`. Columns: Product, Variant, Sales (30d), Avg Stock, Turnover rate (formatted as `X.XX`). Sort default by `turnover` descending. Color-code turnover: high (>3) = green, moderate (1-3) = default, low (<1) = amber.

---

## Card 15 — Stock Value by Category

**Endpoint:** `GET /api/dashboard/stock`
**Response path:** `.stock_value_by_category`

**Viz:** Tree map (if recharts supports) or horizontal bar chart. Block size/bar length = `total_value`. Label = `category` + variant count. Format `total_value` as currency.

---

## Card 16 — Dead Stock (90 days without sales)

**Endpoint:** `GET /api/dashboard/stock`
**Response path:** `.dead_stock`

**Viz:** shadcn/ui `<Table>`. Columns: Product, Variant, Stock, Days without sale. `<Badge>` days_without_sale with red for > 90.

---

## Card 17 — User Stats

**Endpoint:** `GET /api/users/stats`
**Response path:** root object
**TypeScript:**

```ts
type UserStats = {
  total: number;
  byRole: Record<string, number>;
  recent: number;
};
```

**Viz:** Row of 3-5 stat tiles. One for total users, one per role (SUPER_ADMIN, ADMIN, EMPLOYEE), one for "new in last 30 days". Use shadcn/ui `<Card>` with large number + small label below.

---

## Error Handling

Every endpoint may return `{ error: "message" }` with these HTTP statuses:

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Expired/invalid token | Redirect to login |
| 500 | Server error | Show toast/error banner with message |

Wrap all fetch calls in a try/catch. On network failure, show a skeleton/loading state — don't crash the dashboard.

## Date Range Selector

Add a top-level date range control. Two modes:

1. **Quick presets** (shadcn/ui `<Select>`) — `7d`, `15d`, `30d` (default), `60d`, `90d`. Sets the `days` param on all 3 dashboard endpoints.
2. **Explicit date picker** (shadcn/ui `DatePicker` or `<Popover>` with calendar) — allows picking `startDate` and `endDate`. When set, switches all 3 endpoints from `?days=N` to `?startDate=...&endDate=...`. Clears `days`.

Changing either control refetches all endpoints and resets the 60s polling interval.

## Full TypeScript Types Reference

```ts
// GET /api/dashboard/stock
type StockResponse = {
  low_stock: LowStockItem[];
  no_sales_30d: NoSalesItem[];
  turnover_rate: TurnoverItem[];
  stock_value_by_category: StockValueByCategory[];
  dead_stock: DeadStockItem[];
};

type LowStockItem = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  stock: number;
};

type NoSalesItem = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  stock: number;
};

type TurnoverItem = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  sales_qty_30d: number;
  avg_stock: number;
  turnover: number;
};

type StockValueByCategory = {
  category: string | null;
  total_value: number;
  variant_count: number;
};

type DeadStockItem = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  stock: number;
  days_without_sale: number;
};

// GET /api/dashboard/marketing?days=30
type MarketingResponse = {
  by_storefront: StorefrontStats[];
  by_province: ProvinceStats[];
  by_campaign: CampaignStats[];
  by_source: SourceStats[];
  by_payment_method: PaymentMethodStats[];
};

type StorefrontStats = {
  storefront: string | null;
  orders: number;
  revenue: number;
};

type ProvinceStats = {
  province: string | null;
  orders: number;
  revenue: number;
};

type CampaignStats = {
  campaign: string | null;
  orders: number;
  revenue: number;
  aov: number;
};

type SourceStats = {
  source: string | null;
  medium: string | null;
  orders: number;
  revenue: number;
};

type PaymentMethodStats = {
  method: string | null;
  orders: number;
  revenue: number;
};

// GET /api/dashboard/orders?days=30
type OrdersResponse = {
  by_hour: HourStats[];
  top_products: TopProductItem[];
  average_order_value: number;
  revenue_trend: RevenueTrendItem[];
  by_status: OrderStatusStats[];
  repeat_customers: RepeatCustomers;
};

type HourStats = {
  hour: number;
  orders: number;
  revenue: number;
};

type TopProductItem = {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  total_sold: number;
  revenue: number;
};

type RevenueTrendItem = {
  date: string;
  revenue: number;
  orders: number;
};

type OrderStatusStats = {
  status: string;
  count: number;
};

type RepeatCustomers = {
  unique_customers: number;
  repeat_customers: number;
  repeat_rate: number;
};

// GET /api/users/stats
type UserStats = {
  total: number;
  byRole: Record<string, number>;
  recent: number;
};
```

## Implementation Order (Recommended)

1. Auth check + fetch wrapper (bearer token, 401 → logout)
2. KPI row (Card 1) and User Stats (Card 17) — simplest, no charts
3. Revenue trend chart (Card 2) — introduces recharts
4. Remaining orders cards (3-6)
5. Marketing cards (7-11)
6. Stock cards (12-16)
7. Day window selector
8. Polling interval (60s)
9. WebSocket reconnect + refetch trigger
