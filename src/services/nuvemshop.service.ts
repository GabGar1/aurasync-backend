import axios from 'axios';
import { productService } from './product.service.js';
import { orderService } from "./order.service.js";
import { db } from '../lib/db.js';

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
      'closed': 'DELIVERED', // Assuming closed means delivered
      'cancelled': 'CANCELED',
      'paid': 'PAID',
      'shipped': 'SHIPPED',
    };
    return statusMap[nuvemStatus] || 'PENDING';
  }


  async syncProducts() {
    console.log('Starting full product synchronization with Nuvemshop...');

    try {
      let page = 1;
      let hasMore = true;
      let importedCount = 0;
      const perPage = 200;

      while (hasMore) {
        console.log(`Fetching product page ${page}...`);

        const response = await axios.get(`${this.baseUrl}/products`, {
          headers: this.headers,
          params: {
            page: page,
            per_page: perPage
          }
        });

        const nuvemProducts = response.data;

        if (!nuvemProducts || nuvemProducts.length === 0) {
          hasMore = false;
          break;
        }

        for (const np of nuvemProducts) {
          // Use upsert to handle both new products and updates to existing ones
          await productService.upsertProductFromNuvemshop({
            id: np.id.toString(),
            name: np.name?.pt || 'Produto sem nome',
            category: np.categories?.[0]?.name?.pt || 'Geral',
            is_active: np.published,
            variants: np.variants.map((nv: any) => ({
              id: nv.id.toString(),
              sku: nv.sku || `SKU-${nv.id}`,
              name: nv.values?.map((v: any) => v.pt).join(' / ') || 'Padrão',
              price: parseFloat(nv.price || '0'),
              cost_price: parseFloat(nv.cost || '0'),
              stock_quantity: nv.stock || 0
            }))
          });
          importedCount++;
        }

        if (nuvemProducts.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }

      console.log(`Synchronization complete! ${importedCount} products processed.`);
      return { success: true, processed: importedCount };

    } catch (error: any) {
      console.error('Error syncing products with Nuvemshop:', error.response?.data || error.message);
      throw new Error('Failed to integrate with Nuvemshop');
    }
  }

  async syncOrders() {
    console.log('Starting order synchronization with Nuvemshop...');
    try {
      let page = 1;
      let hasMore = true;
      let processedCount = 0;
      const perPage = 50;

      while (hasMore) {
        console.log(`Fetching order page ${page}...`);
        const response = await axios.get(`${this.baseUrl}/orders`, {
          headers: this.headers,
          params: { page, per_page: perPage, status: 'any' }
        });

        const nuvemOrders = response.data;
        if (!nuvemOrders || nuvemOrders.length === 0) {
          hasMore = false;
          break;
        }

        for (const nuvemOrder of nuvemOrders) {
          // Use upsert to handle both new orders and updates to existing ones
          await orderService.handleNuvemshopWebhook({
            id: nuvemOrder.id.toString(),
            customer: {
              name: nuvemOrder.customer?.name || 'Customer Not Available',
            },
            status: nuvemOrder.status,
            total: parseFloat(nuvemOrder.total),
            items: nuvemOrder.products.map((item: any) => ({
              variant_id: item.variant_id.toString(),
              quantity: item.quantity,
              price: parseFloat(item.price)
            }))
          });
          processedCount++;
        }

        if (nuvemOrders.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
      console.log(`Order synchronization complete! ${processedCount} orders processed.`);
      return { success: true, processed: processedCount };
    } catch (error: any) {
      console.error('Error syncing orders with Nuvemshop:', error.response?.data || error.message);
      throw new Error('Failed to integrate orders with Nuvemshop');
    }
  }
}

export const nuvemshopService = new NuvemshopService();
