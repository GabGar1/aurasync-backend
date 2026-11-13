import { db } from '../lib/db.js';
import type { Knex } from 'knex';

export class CreditFeeRepository {
  private table = 'credit_fee_tiers';

  /** All tiers (active and inactive) for the settings screen, so a tier can be turned back on. */
  async listAll() {
    return db(this.table).whereNull('deleted_at').orderBy('installments', 'asc');
  }

  async findById(id: string) {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  /** The tier charged on a sale: inactive tiers are not charged. */
  async findByInstallments(n: number, trx?: Knex.Transaction) {
    const query = trx ?? db;
    return (await query(this.table).where({ installments: n, is_active: true }).whereNull('deleted_at').first()) || null;
  }

  /** Any tier with this installment count, active or not (uniqueness check). */
  async existsForInstallments(n: number) {
    return !!(await db(this.table).where({ installments: n }).whereNull('deleted_at').first());
  }

  async create(data: { installments: number; percent: number; fixed_fee: number }) {
    const [row] = await db(this.table).insert(data).returning('*');
    return row;
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
