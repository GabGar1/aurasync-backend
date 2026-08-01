import { db } from '../lib/db.js';
import type { Knex } from 'knex';
import type { CostComponent, CostComponentCreate, CostComponentUpdate, CostAssociationCreate } from '../schemas/cost.schema.js';

export interface ComponentWithQuantity {
  id: string;
  name: string;
  type: string;
  category: string;
  value: number;
  calculation_base: string;
  quantity: number;
}

export class CostRepository {
  private table = 'cost_components';
  private associationTable = 'product_cost_components';

  async createComponent(data: Omit<CostComponentCreate, 'id' | 'created_at' | 'updated_at'> & { is_active: boolean }): Promise<CostComponent> {
    const [row] = await db(this.table).insert(data).returning('*');
    return row;
  }

  async updateComponent(id: string, data: CostComponentUpdate): Promise<CostComponent | null> {
    const [row] = await db(this.table)
      .where({ id })
      .whereNull('deleted_at')
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return row || null;
  }

  async softDeleteComponent(id: string): Promise<boolean> {
    const result = await db(this.table)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), is_active: false, updated_at: new Date() });
    return result > 0;
  }

  async listComponents(filter: { is_active?: boolean; search?: string } = {}): Promise<CostComponent[]> {
    let query = db(this.table).whereNull('deleted_at').orderBy('name', 'asc');
    if (filter.is_active !== undefined) query = query.where('is_active', filter.is_active);
    if (filter.search) query = query.where('name', 'ilike', `%${filter.search}%`);
    return query;
  }

  async findComponentById(id: string): Promise<CostComponent | null> {
    return (await db(this.table).where({ id }).whereNull('deleted_at').first()) || null;
  }

  async associateComponent(data: CostAssociationCreate): Promise<{ id: string; product_id: string; cost_component_id: string; quantity: number }> {
    const [row] = await db(this.associationTable)
      .insert(data)
      .onConflict(['product_id', 'cost_component_id'])
      .merge({ quantity: data.quantity })
      .returning('*');
    return row;
  }

  async hardDeleteAssociation(id: string): Promise<boolean> {
    const result = await db(this.associationTable).where({ id }).del();
    return result > 0;
  }

  async listAssociationsByProduct(productId: string): Promise<Array<{ id: string; product_id: string; cost_component_id: string; quantity: number; component: CostComponent }>> {
    const rows = await db(this.associationTable)
      .where(`${this.associationTable}.product_id`, productId)
      .join(this.table, `${this.table}.id`, `${this.associationTable}.cost_component_id`)
      .whereNull(`${this.table}.deleted_at`)
      .select(
        `${this.associationTable}.id`,
        `${this.associationTable}.product_id`,
        `${this.associationTable}.cost_component_id`,
        `${this.associationTable}.quantity`,
        `${this.table}.id as component_id`,
        `${this.table}.name`,
        `${this.table}.description`,
        `${this.table}.type`,
        `${this.table}.category`,
        `${this.table}.value`,
        `${this.table}.calculation_base`,
        `${this.table}.is_active`,
        `${this.table}.created_at`,
        `${this.table}.updated_at`,
      );
    return rows.map((r) => ({
      id: r.id,
      product_id: r.product_id,
      cost_component_id: r.cost_component_id,
      quantity: r.quantity,
      component: {
        id: r.component_id,
        name: r.name,
        description: r.description,
        type: r.type,
        category: r.category,
        value: r.value,
        calculation_base: r.calculation_base,
        is_active: r.is_active,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    }));
  }

  async getComponentsByProductIds(productIds: string[], trx?: Knex.Transaction): Promise<Array<{ product_id: string; quantity: number } & ComponentWithQuantity>> {
    if (productIds.length === 0) return [];
    const query = (trx ?? db);
    return query(this.associationTable)
      .whereIn(`${this.associationTable}.product_id`, productIds)
      .join(this.table, `${this.table}.id`, `${this.associationTable}.cost_component_id`)
      .whereNull(`${this.table}.deleted_at`)
      .select(
        `${this.associationTable}.product_id`,
        `${this.associationTable}.quantity`,
        `${this.table}.id`,
        `${this.table}.name`,
        `${this.table}.type`,
        `${this.table}.category`,
        `${this.table}.value`,
        `${this.table}.calculation_base`,
      );
  }
}

export const costRepository = new CostRepository();
