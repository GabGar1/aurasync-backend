import { db } from '../lib/db.js';
import type { Knex } from 'knex';

export class CreditFeeRepository {
  private table = 'credit_fee_tiers';

  async listActive() {
    return db(this.table).whereNull('deleted_at').where('is_active', true).orderBy('installments', 'asc');
  }

  async findById(id: string) {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  async findByInstallments(n: number, trx?: Knex.Transaction) {
    const query = trx ?? db;
    return (await query(this.table).where({ installments: n }).whereNull('deleted_at').first()) || null;
  }

  async update(id: string, data: { percent?: number | undefined; fixed_fee?: number | undefined; is_active?: boolean | undefined }) {
    const [row] = await db(this.table)
      .where({ id }).whereNull('deleted_at')
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return row || null;
  }
}

export const creditFeeRepository = new CreditFeeRepository();
