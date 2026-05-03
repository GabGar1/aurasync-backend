import axios from 'axios';
import { productService } from './product.service.js';
import { orderService } from "./order.service.js";
import { db } from '../lib/db.js';
import { websocketManager } from '../lib/websocket.js';

class NuvemshopService {
  private get baseUrl() {
    return `https://api.tiendanube.com/v1/${process.env.NUVEMSHOP_STORE_ID}`;
  }

  private get headers() {
    return {
      'Authentication': `bearer ${process.env.NUVEMSHOP_ACCESS_TOKEN}`,
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
          })),
        };
        return productService.upsertProductFromNuvemshop(productData as any);
      });

      const results = await Promise.all(upsertPromises);

      websocketManager.broadcast({
        event: 'products_updated',
        message: `Bulk product sync complete. ${results.length} products processed.`,
      });

      console.log(`Product synchronization complete! ${results.length} products processed.`);
      return { success: true, processed: results.length };

    } catch (error: any) {
      console.error('Error syncing products with Nuvemshop:', error.response?.data || error.message);
      throw new Error('Failed to integrate with Nuvemshop');
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
          customer: { name: nuvemOrder.customer?.name || 'Customer Not Available' },
          status: this.mapNuvemshopStatus(nuvemOrder.status),
          total: parseFloat(nuvemOrder.total),
          items: nuvemOrder.products.map((item: any) => ({
            variant_id: item.variant_id.toString(),
            quantity: item.quantity,
            price: parseFloat(item.price)
          })),
        };
        return orderService.upsertOrderFromNuvemshop(orderData as any);
      });

      const results = await Promise.all(upsertPromises);

      websocketManager.broadcast({
        event: 'orders_updated',
        message: `Bulk order sync complete. ${results.length} orders processed.`,
      });

      console.log(`Order synchronization complete! ${results.length} orders processed.`);
      return { success: true, processed: results.length };

    } catch (error: any) {
      console.error('Error syncing orders with Nuvemshop:', error.response?.data || error.message);
      throw new Error('Failed to integrate orders with Nuvemshop');
    }
  }
}

export const nuvemshopService = new NuvemshopService();