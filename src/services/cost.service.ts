import { costRepository } from '../repositories/cost.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { productSubgroupRepository } from '../repositories/product-subgroup.repository.js';
import { CostSchema, type CostComponentCreate, type CostComponentUpdate, type CostAssociationCreate, type CostAssociateSubgroup, type CostAssociateBatch, type CostSimulateInput } from '../schemas/cost.schema.js';
import { computeOrderCosts } from '../lib/cost-engine.js';
import { db } from '../lib/db.js';

export class CostService {
  async listComponents(filter: { is_active?: boolean; search?: string } = {}) {
    return costRepository.listComponents(filter);
  }

  async createComponent(data: CostComponentCreate) {
    const validated = CostSchema.create.parse(data);
    const payload = {
      name: validated.name,
      type: validated.type,
      category: validated.category ?? 'OTHER',
      value: validated.value,
      calculation_base: validated.calculation_base ?? 'PRICE',
      is_active: validated.is_active ?? true,
      max_products_per_package: validated.max_products_per_package ?? null,
      consolidates: validated.consolidates ?? false,
      allocation_basis: validated.allocation_basis ?? null,
      period_start: validated.period_start ?? null,
      period_end: validated.period_end ?? null,
      applies_to_fair_only: validated.applies_to_fair_only ?? false,
      ...(validated.description !== undefined && { description: validated.description }),
    };
    return costRepository.createComponent(payload);
  }

  async updateComponent(id: string, data: CostComponentUpdate) {
    const validated = CostSchema.update.parse(data);
    const existing = await costRepository.findComponentById(id);
    if (!existing) throw new Error('Cost component not found');
    return costRepository.updateComponent(id, validated);
  }

  async deleteComponent(id: string) {
    const existing = await costRepository.findComponentById(id);
    if (!existing) throw new Error('Cost component not found');
    return costRepository.softDeleteComponent(id);
  }

  async associateComponent(data: CostAssociationCreate) {
    const validated = CostSchema.associate.parse(data);
    const product = await productRepository.findById(validated.product_id);
    if (!product) throw new Error('Product not found');
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new Error('Cost component not found');
    const association = await costRepository.associateComponent(validated);
    const associations = await costRepository.listAssociationsByProduct(validated.product_id);
    const full = associations.find(a => a.id === association.id);
    return full ?? association;
  }

  async removeAssociation(id: string) {
    return costRepository.hardDeleteAssociation(id);
  }

  async getAssociationsByProduct(productId: string) {
    const product = await productRepository.findById(productId);
    if (!product) throw new Error('Product not found');
    const associations = await costRepository.listAssociationsByProduct(productId);
    return associations;
  }

  async simulateCosts(input: CostSimulateInput) {
    const validated = CostSchema.simulate.parse(input);
    const variant = await db('product_variants')
      .where({ id: validated.variant_id })
      .whereNull('deleted_at')
      .first();
    if (!variant) throw new Error('Product variant not found');

    const components = await costRepository.getComponentsByProductIds([variant.product_id]);
    const componentInputs = components.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type as any,
      category: c.category as any,
      value: Number(c.value),
      calculation_base: c.calculation_base as any,
      quantity: c.quantity,
    }));

    const result = computeOrderCosts(
      [{
        variant_id: variant.id,
        product_id: variant.product_id,
        unit_price: validated.unit_price,
        quantity: validated.quantity,
        product_cost: Number(variant.cost_price || 0),
        legacy_packaging_cost: Number(variant.packaging_cost || 0),
        legacy_platform_fee_percent: Number(variant.platform_fee_percent || 0),
        components: componentInputs,
      }],
      { shipping_cost_owner: 0, discount_amount: 0 }
    );

    return result.items[0];
  }

  async associateSubgroup(data: CostAssociateSubgroup) {
    const validated = CostSchema.associateSubgroup.parse(data);
    const subgroup = await productSubgroupRepository.findById(validated.subgroup_id);
    if (!subgroup) throw new Error('Subgroup not found');
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new Error('Cost component not found');
    return costRepository.associateSubgroup(validated);
  }

  async removeSubgroupAssociation(id: string) {
    return costRepository.hardDeleteSubgroupAssociation(id);
  }

  async getAssociationsBySubgroup(subgroupId: string) {
    const subgroup = await productSubgroupRepository.findById(subgroupId);
    if (!subgroup) throw new Error('Subgroup not found');
    return costRepository.listAssociationsBySubgroup(subgroupId);
  }

  async associateBatch(data: CostAssociateBatch) {
    const validated = CostSchema.associateBatch.parse(data);
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new Error('Cost component not found');

    const results: { product: Array<{ product_id: string }>; subgroup: Array<{ subgroup_id: string }> } = { product: [], subgroup: [] };

    for (const productId of validated.product_ids ?? []) {
      const product = await productRepository.findById(productId);
      if (!product) throw new Error(`Product ${productId} not found`);
      const assoc = await costRepository.associateComponent({ product_id: productId, cost_component_id: validated.cost_component_id, quantity: validated.quantity });
      results.product.push({ product_id: assoc.product_id });
    }
    for (const subgroupId of validated.subgroup_ids ?? []) {
      const subgroup = await productSubgroupRepository.findById(subgroupId);
      if (!subgroup) throw new Error(`Subgroup ${subgroupId} not found`);
      const assoc = await costRepository.associateSubgroup({ subgroup_id: subgroupId, cost_component_id: validated.cost_component_id, quantity: validated.quantity });
      results.subgroup.push({ subgroup_id: assoc.subgroup_id });
    }
    return results;
  }
}

export const costService = new CostService();
