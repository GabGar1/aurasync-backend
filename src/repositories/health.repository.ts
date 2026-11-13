import { db } from '../lib/db.js';

export class HealthRepository {
  /** Round trip to Postgres; throws when the database is unreachable. */
  async ping(): Promise<void> {
    await db.raw('select 1');
  }
}

export const healthRepository = new HealthRepository();
