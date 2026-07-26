# Dashboard KPIs — Design Spec

## Purpose

Expose business KPI data (stock health, marketing performance, order analytics) via three REST API endpoints for consumption by a future frontend dashboard.

## Constraints

- JSON API only (no frontend rendering)
- Computed on-the-fly via Knex aggregation queries (no materialized views or caching)
- Follows existing 3-layer architecture: Router → Service → Repository
- Any authenticated user can access (no admin role restriction)
- Zod response schemas for Swagger documentation

## Architecture

```
dashboard.router.ts  →  dashboard.service.ts  →  dashboard.repository.ts  →  Knex
     │                        │                         │
  3 GET endpoints        Orchestrates queries        Raw SQL aggregates
```

## Endpoints

All under prefix `/api/dashboard`.

### GET /api/dashboard/stock

Returns stock health KPIs.

```jsonc
{
  "low_stock": [
    { "product_id": "uuid", "product_name": "...", "variant_name": "...", "sku": "...", "stock": 2 }
  ],
  "no_sales_30d": [
    { "product_id": "uuid", "product_name": "...", "variant_name": "...", "stock": 15 }
  ],
  "turnover_rate": [
    { "product_id": "uuid", "product_name": "...", "variant_name": "...", "sales_qty_30d": 30, "avg_stock": 10, "turnover": 3.0 }
  ],
  "stock_value_by_category": [
    { "category": "Eletrônicos", "total_value": 15000.00, "variant_count": 12 }
  ],
  "dead_stock": [
    { "product_id": "uuid", "product_name": "...", "variant_name": "...", "stock": 8, "days_without_sale": 95 }
  ]
}
```

### GET /api/dashboard/marketing

```jsonc
{
  "by_storefront": [
    { "storefront": "mobile", "orders": 120, "revenue": 15000.00 }
  ],
  "by_province": [
    { "province": "SP", "orders": 300, "revenue": 45000.00 }
  ],
  "by_campaign": [
    { "campaign": "black_friday", "orders": 50, "revenue": 8000.00, "aov": 160.00 }
  ],
  "by_source": [
    { "source": "instagram", "medium": "social", "orders": 80, "revenue": 12000.00 }
  ],
  "by_payment_method": [
    { "method": "credit_card", "orders": 400, "revenue": 60000.00 }
  ]
}
```

### GET /api/dashboard/orders

```jsonc
{
  "by_hour": [
    { "hour": 14, "orders": 45, "revenue": 6750.00 }
  ],
  "top_products": [
    { "product_id": "uuid", "product_name": "...", "variant_name": "...", "total_sold": 200, "revenue": 30000.00 }
  ],
  "average_order_value": 150.50,
  "revenue_trend": [
    { "date": "2026-07-01", "revenue": 5000.00, "orders": 33 }
  ],
  "by_status": [
    { "status": "PAID", "count": 300 }
  ],
  "repeat_customers": {
    "unique_customers": 500,
    "repeat_customers": 125,
    "repeat_rate": 0.25
  }
}
```

## Repository Queries

All queries live in `dashboard.repository.ts`. Key patterns:

### Low stock
```ts
db("product_variants")
  .join("products", "products.id", "product_variants.product_id")
  .where("product_variants.stock_quantity", "<=", threshold)
  .whereNull("product_variants.deleted_at")
  .whereNull("products.deleted_at")
  .select(
    "products.id as product_id",
    "products.name as product_name",
    "product_variants.name as variant_name",
    "product_variants.sku",
    "product_variants.stock_quantity as stock"
  )
  .orderBy("product_variants.stock_quantity", "asc")
```

### No sales 30d / Dead stock
Variants with stock > 0 that do NOT appear in `order_items` (joined through `orders`) within the time window.

### Marketing group-bys
```ts
db("orders")
  .whereNull("deleted_at")
  .groupBy(groupingColumn)
  .select(
    groupingColumn,
    db.raw("COUNT(*)::int as orders"),
    db.raw("COALESCE(SUM(total_amount), 0) as revenue")
  )
  .orderBy("orders", "desc")
```

### Sales by hour
```ts
db("orders")
  .whereNull("deleted_at")
  .groupBy(db.raw("EXTRACT(HOUR FROM created_at)::int"))
  .select(
    db.raw("EXTRACT(HOUR FROM created_at)::int as hour"),
    db.raw("COUNT(*)::int as orders"),
    db.raw("COALESCE(SUM(total_amount), 0) as revenue")
  )
  .orderBy("hour")
```

### Repeat customers
Count distinct `customer_email`, then count those with >1 order.

All queries filter `deleted_at IS NULL` and only consider non-cancelled orders where appropriate.

## Files to create

| File | Purpose |
|---|---|
| `src/schemas/dashboard.schema.ts` | Zod schemas for each endpoint response |
| `src/repositories/dashboard.repository.ts` | All Knex aggregation queries |
| `src/services/dashboard.service.ts` | Orchestration layer (thin, calls repo) |
| `src/routers/dashboard.router.ts` | 3 GET endpoints, auth + role middleware |
| `src/services/dashboard.service.integration.test.ts` | Integration tests |

## Testing

- Create seed data: products, variants, orders, order_items
- Call each dashboard service method
- Assert counts, sums, groupings match expected values
- `cleanupDatabase()` in `before`/`after` (preserves users)
- Tests available to any role — use `EMPLOYEE` token for router tests
