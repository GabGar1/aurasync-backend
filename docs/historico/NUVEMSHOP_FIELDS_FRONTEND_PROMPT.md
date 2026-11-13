# Nuvemshop Order/Product Fields — Frontend Changes

## Summary

5 new fields added to the API to expose richer Nuvemshop data. These enable showing payment status, fulfillment/delivery status, free shipping badge, and promotional price indicators.

---

## New Fields on `GET /api/orders` and WebSocket `orders_updated`

### Response Shape Changes

```ts
// Existing Order object now includes:
type Order = {
  // ... existing fields ...
  status: string;            // Now uses Nuvemshop values: "open", "closed", "cancelled", "paid", "shipped"
  payment_status: string | null;   // NEW
  fulfillment_status: string | null; // NEW
  has_free_shipping: boolean | null; // NEW
  
  // Existing items now include:
  items: Array<{
    // ... existing fields ...
    has_promotional_price: boolean | null; // NEW
  }>;
};
```

### Field Details

| Field | Type | Possible Values | Description |
|-------|------|----------------|-------------|
| `status` | `string` | `open`, `closed`, `cancelled`, `paid`, `shipped` | Nuvemshop order-level status (was previously mapped to PENDING/PAID/DELIVERED) |
| `payment_status` | `string \| null` | `paid`, `pending`, `overdue`, `refunded`, `partially_refunded`, `partially_paid`, `disputed`, `under_review` | Payment status from Nuvemshop |
| `fulfillment_status` | `string \| null` | Delivery step in Portuguese: "Por embalar", "Por enviar", "Enviadas", "Entregues ou retirados", etc. | Status of the first fulfillment/shipment |
| `has_free_shipping` | `boolean \| null` | `true`, `false`, `null` | Whether the order qualified for free shipping |
| `items[].has_promotional_price` | `boolean \| null` | `true`, `false`, `null` | Whether this item was sold at a promotional price |

### How to Display

| Field | UI Treatment |
|-------|-------------|
| `payment_status` | Badge with color per status: `paid`=green, `pending`=amber, `overdue`=red, `refunded`=purple, `under_review`=blue |
| `fulfillment_status` | Badge or progress step indicator. Portuguese labels are user-facing: "Por embalar" → "To pack", "Enviadas" → "Shipped", "Entregues" → "Delivered" |
| `has_free_shipping` | Show a truck icon + "Frete Grátis" badge when `true` |
| `items[].has_promotional_price` | Show a tag/badge on the item row when `true`, e.g. "Promo" or strikethrough original price |
| `status` | Order lifecycle status. Filter/tab options: open (Ativas), cancelled (Canceladas), closed (Arquivadas) |

---

## New Field on `GET /api/products` and WebSocket `products_updated`

### Response Shape Changes

```ts
type ProductVariant = {
  // ... existing fields ...
  has_promotional_price: boolean | null; // NEW
};
```

| Field | Type | Description |
|-------|------|-------------|
| `variants[].has_promotional_price` | `boolean \| null` | Whether this variant currently has a promotional price in Nuvemshop |

**UI:** Show a "Promoção" badge on product cards/variant rows when `has_promotional_price` is `true`. Useful for inventory management and listing pages.

---

## Migration Notes

- Old orders may have `null` for all new fields (they won't be backfilled — only new syncs populate them).
- The `status` field now uses Nuvemshop values directly (`open`, `closed`, `cancelled`, `paid`, `shipped`) instead of the previously mapped enum (`PENDING`, `PAID`, `SHIPPED`, `DELIVERED`, `CANCELED`). Update any status-based filters/tabs/badges accordingly. The new values map as:
  - `open` → Active orders (previously PENDING/PAID/SHIPPED mixed)
  - `closed` → Delivered (previously DELIVERED)
  - `cancelled` → Cancelled (previously CANCELED)
  - `paid` → Paid awaiting shipment
  - `shipped` → Shipped in transit
- After a full resync all orders will have proper values.
