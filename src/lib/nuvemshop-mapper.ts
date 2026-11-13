import type { NuvemshopOrderData } from '../repositories/order.repository.js';
import type { NuvemshopProductData } from '../repositories/product.repository.js';

/**
 * Single translation layer between the Nuvemshop REST payloads and AuraSync's
 * upsert inputs. Used by the manual sync and by the webhook, so both paths
 * store exactly the same data.
 */

const toNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
};

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const n = toNumber(value, NaN);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * On Nuvemshop `status` is only open/closed/cancelled ("closed" = archived).
 * Payment and delivery progress live in `payment_status` and `shipping_status`,
 * so the internal status is derived from the three fields together.
 */
export function mapNuvemshopOrderStatus(order: {
  status?: string | null;
  payment_status?: string | null;
  shipping_status?: string | null;
}): string {
  const payment = order.payment_status ?? '';
  const shipping = order.shipping_status ?? '';

  if (order.status === 'cancelled' || payment === 'voided' || payment === 'refunded') return 'CANCELED';
  if (shipping === 'delivered') return 'DELIVERED';
  if (shipping === 'shipped') return 'SHIPPED';
  if (payment === 'paid' || payment === 'partially_refunded') return 'PAID';
  return 'PENDING';
}

/** First image by position, accepted only as an https URL (it is rendered in an <img>). */
function firstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0));
  const src = (sorted[0] as any)?.src;
  return typeof src === 'string' && /^https:\/\//i.test(src) ? src : null;
}

export function mapNuvemshopOrder(raw: any): NuvemshopOrderData {
  return {
    id: String(raw.id),
    number: raw.number === null || raw.number === undefined ? null : String(raw.number),
    customer: { name: raw.customer?.name || raw.contact_name || 'Cliente não informado' },
    status: mapNuvemshopOrderStatus(raw),
    total: toNumber(raw.total),
    items: (raw.products ?? []).map((item: any) => ({
      variant_id: String(item.variant_id),
      quantity: Number(item.quantity),
      price: toNumber(item.price),
      has_promotional_price: item.has_promotional_price ?? false,
    })),
    discount: raw.discount,
    shipping_cost_customer: raw.shipping_cost_customer,
    shipping_cost_owner: raw.shipping_cost_owner,
    payment_status: raw.payment_status,
    fulfillments: raw.fulfillments,
    free_shipping_config: raw.free_shipping_config,
    created_at: raw.created_at,
    paid_at: raw.paid_at,
    shipped_at: raw.shipped_at,
    completed_at: raw.completed_at,
    cancelled_at: raw.cancelled_at,
    payment_details: raw.payment_details,
    gateway: raw.gateway,
    shipping_address: raw.shipping_address,
    shipping_carrier_name: raw.shipping_carrier_name,
    customer_visit: raw.customer_visit,
    storefront: raw.storefront,
    contact_email: raw.contact_email,
  } as NuvemshopOrderData;
}

export function mapNuvemshopProduct(raw: any): NuvemshopProductData {
  return {
    id: String(raw.id),
    name: raw.name?.pt || 'Produto sem nome',
    category: raw.categories?.[0]?.name?.pt || 'Geral',
    is_active: Boolean(raw.published),
    image_url: firstImageUrl(raw.images),
    variants: (raw.variants ?? []).map((v: any) => {
      const variant: Record<string, unknown> = {
        id: String(v.id),
        sku: v.sku || null,
        price: toNumber(v.price),
        stock_quantity: v.stock === null || v.stock === undefined ? 0 : Number(v.stock),
        cost_price: toNumber(v.cost),
        has_promotional_price: v.has_promotional_price ?? false,
      };
      for (const key of ['weight', 'height', 'width', 'depth'] as const) {
        const value = optionalNumber(v[key]);
        if (value !== undefined) variant[key] = value;
      }
      return variant;
    }),
  } as NuvemshopProductData;
}
