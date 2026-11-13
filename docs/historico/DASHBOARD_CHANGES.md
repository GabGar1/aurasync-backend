# Dashboard API — Recent Changes

## 1. All metrics now use `completed_at`

Every dashboard endpoint now filters and groups by `orders.completed_at` instead of `orders.created_at`. This means:

- **Revenue trend** — revenue is recognized on the date the order was completed, not created
- **Orders by hour** — shows the hour customers actually complete the purchase (Card 3)
- **Marketing attribution** — storefront, campaigns, sources, etc. only count completed orders
- **Stock turnover / no sales / dead stock** — only considers completed sales
- **AOV, top products, repeat customers** — scoped to completed orders

## 2. Date range filter on all 3 dashboard endpoints

**What changed:**
- `GET /api/dashboard/orders` — now accepts `days`, `startDate`, `endDate`
- `GET /api/dashboard/marketing` — now accepts `days`, `startDate`, `endDate`
- `GET /api/dashboard/stock` — now accepts `days`, `startDate`, `endDate` (previously had no params)

**How it works:**

| Param | Example | Description |
|-------|---------|-------------|
| `days` | `?days=30` | Sliding window (default 30). startDate = today - days, endDate = today. |
| `startDate` | `?startDate=2026-06-01&endDate=2026-06-30` | Explicit range start (ISO date). Mutually exclusive with `days`. |
| `endDate` | Same as above | Explicit range end. Required if `startDate` is set. |

When `startDate`/`endDate` are provided, `days` is ignored.

**`users/stats`** is the only dashboard endpoint without date filtering.

## 3. Revenue trend now matches day range

The `revenue_trend` array previously had a hardcoded `.limit(30)` — it now returns exactly as many data points as the selected range (e.g. `?days=90` returns 90 daily rows).

## 4. Stock metrics respond to date range

- `no_sales_30d` — now shows variants with no completed sales in the selected range
- `turnover_rate` — sales velocity calculated over the selected range
- `dead_stock` — variants with no sales in the selected range (same range)
- `low_stock` and `stock_value_by_category` — still unfiltered (current-state snapshots unaffected by date)
