import axios from 'axios';
import { productService } from './product.service.js';
import { orderService } from './order.service.js';
import { websocketManager } from '../lib/websocket.js';
import { AppError, ConflictError } from '../lib/errors.js';
import { runInBatches } from '../lib/batch.js';
import { mapNuvemshopOrder, mapNuvemshopProduct } from '../lib/nuvemshop-mapper.js';
import { syncStateRepository, type SyncResource } from '../repositories/sync-state.repository.js';

export interface SyncOptions {
  /** Ignore the last checkpoint and fetch every record. */
  full?: boolean;
}

export interface SyncResult {
  success: true;
  processed: number;
  mode: 'full' | 'incremental';
}

export interface WebhookEvent {
  store_id?: number | string | undefined;
  event: string;
  id: number | string;
}

export interface WebhookResult {
  status: 'processed' | 'ignored';
  event: string;
  reason?: string;
}

const DEFAULT_API_URL = 'https://api.tiendanube.com/v1';
const DEFAULT_USER_AGENT = 'AuraSync App (utopiapedras@gmail.com)';

class NuvemshopService {
  // Bounded concurrency: each upsert holds a pooled DB connection, so batches
  // must stay well below the knex pool max (10) to avoid pool exhaustion.
  private static readonly BATCH_SIZE = 5;
  // Nuvemshop accepts up to 200 records per page.
  private static readonly PAGE_SIZE = 200;
  private static readonly MAX_RATE_LIMIT_RETRIES = 3;
  private static readonly MAX_RATE_LIMIT_WAIT_MS = 10_000;
  // Records updated while the previous sync was running are fetched again.
  private static readonly INCREMENTAL_OVERLAP_MS = 5 * 60_000;

  private readonly running = new Set<SyncResource>();

  private get baseUrl() {
    return `${process.env.NUVEMSHOP_API_URL || DEFAULT_API_URL}/${process.env.NUVEMSHOP_STORE_ID}`;
  }

  private get headers() {
    return {
      Authorization: `bearer ${process.env.NUVEMSHOP_ACCESS_TOKEN}`,
      'User-Agent': process.env.NUVEMSHOP_USER_AGENT || DEFAULT_USER_AGENT,
      'Content-Type': 'application/json',
    };
  }

  /** GET with retry on 429, waiting the time Nuvemshop reports in `x-rate-limit-reset` (ms). */
  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await axios.get<T>(`${this.baseUrl}${path}`, { headers: this.headers, params, timeout: 15_000 });
        return response.data;
      } catch (error: any) {
        if (error.response?.status !== 429 || attempt >= NuvemshopService.MAX_RATE_LIMIT_RETRIES) throw error;
        const reset = Number(error.response.headers?.['x-rate-limit-reset']);
        const waitMs = Math.min(Number.isFinite(reset) && reset > 0 ? reset : 1000, NuvemshopService.MAX_RATE_LIMIT_WAIT_MS);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  /** Walks every page; Nuvemshop answers 404 for a page past the end. */
  private async listAll(resource: SyncResource, params: Record<string, unknown>): Promise<any[]> {
    const all: any[] = [];
    const perPage = NuvemshopService.PAGE_SIZE;
    for (let page = 1; ; page++) {
      let items: any[];
      try {
        items = await this.get<any[]>(`/${resource}`, { ...params, page, per_page: perPage });
      } catch (error: any) {
        if (error.response?.status === 404) break;
        throw error;
      }
      all.push(...items);
      if (items.length < perPage) break;
    }
    return all;
  }

  /** Current state of one record, or null when it no longer exists on Nuvemshop. */
  private async fetchById(resource: SyncResource, id: string | number): Promise<any | null> {
    try {
      return await this.get(`/${resource}/${encodeURIComponent(String(id))}`);
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      throw new AppError(`Failed to fetch ${resource} ${id} from Nuvemshop`, 502, { cause: error });
    }
  }

  isSyncing(resource: SyncResource): boolean {
    return this.running.has(resource);
  }

  /**
   * Shared sync skeleton: one run per resource at a time, incremental from the last
   * successful checkpoint unless `full`, and the checkpoint only moves on success.
   */
  private async runSync(
    resource: SyncResource,
    options: SyncOptions,
    extraParams: Record<string, unknown>,
    upsert: (raw: any) => Promise<unknown>,
  ): Promise<SyncResult> {
    if (this.running.has(resource)) {
      throw new ConflictError('Synchronization already in progress');
    }
    this.running.add(resource);

    try {
      const startedAt = new Date();
      const since = options.full ? null : await syncStateRepository.getLastSyncedAt(resource);
      const params: Record<string, unknown> = { ...extraParams };
      if (since) {
        params.updated_at_min = new Date(since.getTime() - NuvemshopService.INCREMENTAL_OVERLAP_MS).toISOString();
      }
      const mode = since ? 'incremental' : 'full';

      let records: any[];
      try {
        records = await this.listAll(resource, params);
      } catch (error: any) {
        console.error(`Error fetching ${resource} from Nuvemshop:`, error.response?.data || error.message);
        throw new AppError(`Failed to integrate ${resource} with Nuvemshop`, 502, { cause: error });
      }

      const results = await runInBatches(records, NuvemshopService.BATCH_SIZE, upsert);
      await syncStateRepository.setLastSyncedAt(resource, startedAt);

      websocketManager.broadcast({
        event: `${resource}_updated`,
        message: `Bulk ${resource} sync complete. ${results.length} records processed.`,
      });

      return { success: true, processed: results.length, mode };
    } finally {
      this.running.delete(resource);
    }
  }

  syncProducts(options: SyncOptions = {}): Promise<SyncResult> {
    return this.runSync('products', options, {}, (raw) =>
      productService.upsertProductFromNuvemshop(mapNuvemshopProduct(raw)),
    );
  }

  syncOrders(options: SyncOptions = {}): Promise<SyncResult> {
    return this.runSync('orders', options, { status: 'any' }, (raw) =>
      orderService.upsertOrderFromNuvemshop(mapNuvemshopOrder(raw)),
    );
  }

  /**
   * Nuvemshop webhooks carry only `{ store_id, event, id }`. The current record is
   * fetched by id and stored through the same mapper as the sync, which makes
   * redeliveries and out-of-order deliveries harmless (always the latest state).
   */
  async handleWebhook(payload: WebhookEvent): Promise<WebhookResult> {
    const { event } = payload;
    const expectedStore = process.env.NUVEMSHOP_STORE_ID;
    if (expectedStore && payload.store_id !== undefined && String(payload.store_id) !== String(expectedStore)) {
      return { status: 'ignored', event, reason: 'other_store' };
    }

    if (event === 'product/deleted') {
      await productService.handleNuvemshopProductDeleted(String(payload.id));
      return { status: 'processed', event };
    }

    if (event === 'product/created' || event === 'product/updated') {
      const raw = await this.fetchById('products', payload.id);
      if (!raw) return { status: 'ignored', event, reason: 'not_found' };
      await productService.handleNuvemshopWebhook(mapNuvemshopProduct(raw));
      return { status: 'processed', event };
    }

    if (event.startsWith('order/')) {
      const raw = await this.fetchById('orders', payload.id);
      if (!raw) return { status: 'ignored', event, reason: 'not_found' };
      await orderService.handleNuvemshopWebhook(mapNuvemshopOrder(raw));
      return { status: 'processed', event };
    }

    return { status: 'ignored', event, reason: 'unhandled_event' };
  }
}

export const nuvemshopService = new NuvemshopService();
