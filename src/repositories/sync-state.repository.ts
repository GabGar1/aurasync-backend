import { db } from '../lib/db.js';

export type SyncResource = 'products' | 'orders';

export class SyncStateRepository {
  private table = 'integration_sync_state';

  async getLastSyncedAt(resource: SyncResource): Promise<Date | null> {
    const row = await db(this.table).where({ resource }).first();
    return row ? new Date(row.last_synced_at) : null;
  }

  async setLastSyncedAt(resource: SyncResource, at: Date): Promise<void> {
    await db(this.table)
      .insert({ resource, last_synced_at: at })
      .onConflict('resource')
      .merge({ last_synced_at: at, updated_at: new Date() });
  }
}

export const syncStateRepository = new SyncStateRepository();
