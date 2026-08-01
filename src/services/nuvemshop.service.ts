import axios from 'axios';
import { productService } from './product.service.js';
import { orderService } from "./order.service.js";
import { websocketManager } from '../lib/websocket.js';

console.log('=== [AuraSync Debug] Verificando Variáveis de Ambiente ===');
console.log('STORE_ID:', process.env.NUVEMSHOP_STORE_ID);
console.log('TOKEN EXISTE?:', !!process.env.NUVEMSHOP_ACCESS_TOKEN);
console.log('========================================================');

class NuvemshopService {
  // Bounded concurrency: each upsert holds a pooled DB connection, so batches
  // must stay well below the knex pool max (10) to avoid pool exhaustion.
  private static readonly BATCH_SIZE = 5;

  private get baseUrl() {
    return `https://api.tiendanube.com/v1/${process.env.NUVEMSHOP_STORE_ID}`;
  }

  private get headers() {
    return {
      'Authorization': `bearer ${process.env.NUVEMSHOP_ACCESS_TOKEN}`,
      'User-Agent': 'AuraSync App (utopiapedras@gmail.com)',
      'Content-Type': 'application/json'
    };
  }

  private mapNuvemshopStatus(nuvemStatus: string): string {
    const statusMap: { [key: string]: string } = {
      'open': 'PENDING',
      'closed': 'DELIVERED',
      'cancelled': 'CANCELED',
      'paid': 'PAID',
      'shipped': 'SHIPPED',
    };
    return statusMap[nuvemStatus] || 'PENDING';
  }

  async syncProducts() {
    console.log('Starting full product synchronization with Nuvemshop...');
    try {
      const allNuvemProducts = [];
      let page = 1;
      const perPage = 200;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching product page ${page}...`);
        try {
          const response = await axios.get(`${this.baseUrl}/products`, {
            headers: this.headers,
            params: { page, per_page: perPage },
          });
          const nuvemProducts = response.data;
          if (nuvemProducts.length > 0) {
            allNuvemProducts.push(...nuvemProducts);
            page++;
          } else {
            hasMore = false;
          }
        } catch (error: any) {
          if (error.response && error.response.status === 404) {
            console.log('Reached the last page of products.');
            hasMore = false;
          } else {
            throw error;
          }
        }
      }

      console.log(`Found ${allNuvemProducts.length} total products in Nuvemshop. Processing...`);

      const upsertPromises = allNuvemProducts.map(np => {
        const productData = {
          id: np.id.toString(),
          name: np.name?.pt || 'Produto sem nome',
          category: np.categories?.[0]?.name?.pt || 'Geral',
          is_active: np.published,
          variants: np.variants.map((nv: any) => ({
            id: nv.id.toString(),
            sku: nv.sku || null,
            price: parseFloat(nv.price || '0'),
            stock_quantity: nv.stock === null ? 0 : nv.stock,
            cost_price: parseFloat(nv.cost || '0'),
            has_promotional_price: nv.has_promotional_price ?? false,
            weight: nv.weight ? parseFloat(nv.weight) : undefined,
            height: nv.height ? parseFloat(nv.height) : undefined,
            width: nv.width ? parseFloat(nv.width) : undefined,
            depth: nv.depth ? parseFloat(nv.depth) : undefined,
          })),
        };
        return productService.upsertProductFromNuvemshop(productData as any);
      });

      const results = [];
      for (let i = 0; i < upsertPromises.length; i += NuvemshopService.BATCH_SIZE) {
        const batch = upsertPromises.slice(i, i + NuvemshopService.BATCH_SIZE);
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
      }

      websocketManager.broadcast({
        event: 'products_updated',
        message: `Bulk product sync complete. ${results.length} products processed.`,
      });

      console.log(`Product synchronization complete! ${results.length} products processed.`);
      return { success: true, processed: results.length };

    } catch (error: any) {
      console.error('Error syncing products with Nuvemshop:', error.response?.data || error.message);
      throw new Error('Failed to integrate with Nuvemshop', { cause: error });
    }
  }

  async syncOrders() {
    console.log('Starting order synchronization with Nuvemshop...');
    try {
      const allNuvemOrders = [];
      let page = 1;
      const perPage = 50;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching order page ${page}...`);
        try {
          const response = await axios.get(`${this.baseUrl}/orders`, {
            headers: this.headers,
            params: { page, per_page: perPage, status: 'any' },
          });
          const nuvemOrders = response.data;
          if (nuvemOrders.length > 0) {
            allNuvemOrders.push(...nuvemOrders);
            page++;
          } else {
            hasMore = false;
          }
        } catch (error: any) {
          if (error.response && error.response.status === 404) {
            console.log('Reached the last page of orders.');
            hasMore = false;
          } else {
            throw error;
          }
        }
      }

      console.log(`Found ${allNuvemOrders.length} total orders in Nuvemshop. Processing...`);

      const upsertPromises = allNuvemOrders.map(nuvemOrder => {
        const orderData = {
          id: nuvemOrder.id.toString(),
          customer: { name: nuvemOrder.customer?.name || nuvemOrder.contact_name || 'Customer Not Available' },
          status: this.mapNuvemshopStatus(nuvemOrder.status),
          total: parseFloat(nuvemOrder.total),
          items: nuvemOrder.products.map((item: any) => ({
            variant_id: item.variant_id.toString(),
            quantity: item.quantity,
            price: parseFloat(item.price),
            has_promotional_price: item.has_promotional_price ?? false,
          })),
          discount: nuvemOrder.discount,
          shipping_cost_customer: nuvemOrder.shipping_cost_customer,
          shipping_cost_owner: nuvemOrder.shipping_cost_owner,
          payment_status: nuvemOrder.payment_status,
          fulfillments: nuvemOrder.fulfillments,
          free_shipping_config: nuvemOrder.free_shipping_config,
          paid_at: nuvemOrder.paid_at,
          shipped_at: nuvemOrder.shipped_at,
          completed_at: nuvemOrder.completed_at,
          cancelled_at: nuvemOrder.cancelled_at,
          payment_details: nuvemOrder.payment_details,
          gateway: nuvemOrder.gateway,
          shipping_address: nuvemOrder.shipping_address,
          shipping_carrier_name: nuvemOrder.shipping_carrier_name,
          customer_visit: nuvemOrder.customer_visit,
          storefront: nuvemOrder.storefront,
          contact_email: nuvemOrder.contact_email,
        };
        return orderService.upsertOrderFromNuvemshop(orderData as any);
      });

      // Process in bounded batches so concurrent transactions never exhaust the
      // DB connection pool (each upsert holds one pooled connection).
      const results = [];
      for (let i = 0; i < upsertPromises.length; i += NuvemshopService.BATCH_SIZE) {
        const batch = upsertPromises.slice(i, i + NuvemshopService.BATCH_SIZE);
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
      }

      websocketManager.broadcast({
        event: 'orders_updated',
        message: `Bulk order sync complete. ${results.length} orders processed.`,
      });

      console.log(`Order synchronization complete! ${results.length} orders processed.`);
      return { success: true, processed: results.length };

    } catch (error: any) {
      console.error('Error syncing orders with Nuvemshop:', error.response?.data || error.message);
      throw new Error('Failed to integrate orders with Nuvemshop', { cause: error });
    }
  }
}

export const nuvemshopService = new NuvemshopService();