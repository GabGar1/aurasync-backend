import { db } from '../lib/db.js';
import type { Knex } from 'knex';
import type { CostComponent, CostComponentCreate, CostComponentUpdate, CostAssociationCreate, CostAssociateSubgroup } from '../schemas/cost.schema.js';

export interface ComponentWithQuantity {
  id: string;
  name: string;
  type: string;
  category: string;
  value: number;
  calculation_base: string;
  quantity: number;
  max_products_per_package?: number | null;
  consolidates?: boolean;
  applies_to_fair_only?: boolean;
}

export class CostRepository {
  private table = 'cost_components';
  private associationTable = 'product_cost_components';

  async createComponent(data: Omit<CostComponentCreate, 'id' | 'created_at' | 'updated_at' | 'max_products_per_package' | 'allocation_basis' | 'period_start' | 'period_end'> & {
    is_active: boolean;
    max_products_per_package?: number | null;
    consolidates?: boolean;
    allocation_basis?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    applies_to_fair_only?: boolean;
  }): Promise<CostComponent> {
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
        `${this.table}.max_products_per_package`,
        `${this.table}.consolidates`,
        `${this.table}.allocation_basis`,
        `${this.table}.period_start`,
        `${this.table}.period_end`,
        `${this.table}.applies_to_fair_only`,
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
        max_products_per_package: r.max_products_per_package,
        consolidates: r.consolidates,
        allocation_basis: r.allocation_basis,
        period_start: r.period_start,
        period_end: r.period_end,
        applies_to_fair_only: r.applies_to_fair_only,
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
        `${this.table}.max_products_per_package`,
        `${this.table}.consolidates`,
        `${this.table}.applies_to_fair_only`,
      );
  }

  async associateSubgroup(data: CostAssociateSubgroup): Promise<{ id: string; subgroup_id: string; cost_component_id: string; quantity: number }> {
    const [row] = await db('subgroup_cost_components')
      .insert(data)
      .onConflict(['subgroup_id', 'cost_component_id'])
      .merge({ quantity: data.quantity })
      .returning('*');
    return row;
  }

  async hardDeleteSubgroupAssociation(id: string): Promise<boolean> {
    const result = await db('subgroup_cost_components').where({ id }).del();
    return result > 0;
  }

  async associateSubgroupBatch(subgroupId: string, componentIds: string[], quantity: number) {
    const rows = componentIds.map(cid => ({ subgroup_id: subgroupId, cost_component_id: cid, quantity }));
    return db('subgroup_cost_components')
      .insert(rows)
      .onConflict(['subgroup_id', 'cost_component_id'])
      .merge({ quantity })
      .returning('*');
  }

  async hardDeleteSubgroupAssociations(subgroupId: string, componentIds: string[]): Promise<boolean> {
    const result = await db('subgroup_cost_components')
      .where({ subgroup_id: subgroupId })
      .whereIn('cost_component_id', componentIds)
      .del();
    return result > 0;
  }

  async listAssociationsBySubgroup(subgroupId: string) {
    const rows = await db('subgroup_cost_components')
      .where('subgroup_cost_components.subgroup_id', subgroupId)
      .join('cost_components', 'cost_components.id', 'subgroup_cost_components.cost_component_id')
      .whereNull('cost_components.deleted_at')
      .select(
        'subgroup_cost_components.id',
        'subgroup_cost_components.subgroup_id',
        'subgroup_cost_components.cost_component_id',
        'subgroup_cost_components.quantity',
        'cost_components.id as component_id',
        'cost_components.name',
        'cost_components.description',
        'cost_components.type',
        'cost_components.category',
        'cost_components.value',
        'cost_components.calculation_base',
        'cost_components.is_active',
        'cost_components.max_products_per_package',
        'cost_components.consolidates',
        'cost_components.allocation_basis',
        'cost_components.period_start',
        'cost_components.period_end',
        'cost_components.applies_to_fair_only',
        'cost_components.created_at',
        'cost_components.updated_at',
      );
    return rows.map((r) => ({
      id: r.id,
      subgroup_id: r.subgroup_id,
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
        max_products_per_package: r.max_products_per_package,
        consolidates: r.consolidates,
        allocation_basis: r.allocation_basis,
        period_start: r.period_start,
        period_end: r.period_end,
        applies_to_fair_only: r.applies_to_fair_only,
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    }));
  }

  async getComponentsBySubgroupIds(subgroupIds: string[], trx?: Knex.Transaction) {
    if (subgroupIds.length === 0) return [];
    const query = (trx ?? db);
    return query('subgroup_cost_components')
      .whereIn('subgroup_cost_components.subgroup_id', subgroupIds)
      .join('cost_components', 'cost_components.id', 'subgroup_cost_components.cost_component_id')
      .whereNull('cost_components.deleted_at')
      .select(
        'subgroup_cost_components.subgroup_id',
        'subgroup_cost_components.quantity',
        'cost_components.id',
        'cost_components.name',
        'cost_components.type',
        'cost_components.category',
        'cost_components.value',
        'cost_components.calculation_base',
        'cost_components.max_products_per_package',
        'cost_components.consolidates',
        'cost_components.applies_to_fair_only',
      );
  }
}

export const costRepository = new CostRepository();
