import { costRepository } from '../repositories/cost.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { productSubgroupRepository } from '../repositories/product-subgroup.repository.js';
import { CostSchema, type CostComponentCreate, type CostComponentUpdate, type CostAssociationCreate, type CostAssociateSubgroup, type CostAssociateBatch, type CostAssociateSubgroupBatch, type CostDeleteSubgroupAssociations, type CostSimulateInput, type CostAssociateProductBatch } from '../schemas/cost.schema.js';
import { computeOrderCosts } from '../lib/cost-engine.js';
import { NotFoundError } from '../lib/errors.js';

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
    if (!existing) throw new NotFoundError('Cost component not found');
    return costRepository.updateComponent(id, validated);
  }

  async deleteComponent(id: string) {
    const existing = await costRepository.findComponentById(id);
    if (!existing) throw new NotFoundError('Cost component not found');
    return costRepository.softDeleteComponent(id);
  }

  async associateComponent(data: CostAssociationCreate) {
    const validated = CostSchema.associate.parse(data);
    const product = await productRepository.findById(validated.product_id);
    if (!product) throw new NotFoundError('Product not found');
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new NotFoundError('Cost component not found');
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
    if (!product) throw new NotFoundError('Product not found');
    const associations = await costRepository.listAssociationsByProduct(productId);
    return associations;
  }

  async simulateCosts(input: CostSimulateInput) {
    const validated = CostSchema.simulate.parse(input);
    const { items } = await costRepository.buildCostEngineItems(
      [{ variant_id: validated.variant_id, unit_price: validated.unit_price, quantity: validated.quantity }],
      undefined,
      { activeVariantsOnly: true }
    );
    if (items.length === 0) throw new NotFoundError('Product variant not found');

    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 0 });

    return result.items[0];
  }

  async associateSubgroup(data: CostAssociateSubgroup) {
    const validated = CostSchema.associateSubgroup.parse(data);
    const subgroup = await productSubgroupRepository.findById(validated.subgroup_id);
    if (!subgroup) throw new NotFoundError('Subgroup not found');
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new NotFoundError('Cost component not found');
    return costRepository.associateSubgroup(validated);
  }

  async removeSubgroupAssociation(id: string) {
    return costRepository.hardDeleteSubgroupAssociation(id);
  }

  async getAssociationsBySubgroup(subgroupId: string) {
    const subgroup = await productSubgroupRepository.findById(subgroupId);
    if (!subgroup) throw new NotFoundError('Subgroup not found');
    return costRepository.listAssociationsBySubgroup(subgroupId);
  }

  async associateBatch(data: CostAssociateBatch) {
    const validated = CostSchema.associateBatch.parse(data);
    const component = await costRepository.findComponentById(validated.cost_component_id);
    if (!component) throw new NotFoundError('Cost component not found');

    const results: { product: Array<{ product_id: string }>; subgroup: Array<{ subgroup_id: string }> } = { product: [], subgroup: [] };

    for (const productId of validated.product_ids ?? []) {
      const product = await productRepository.findById(productId);
      if (!product) throw new NotFoundError(`Product ${productId} not found`);
      const assoc = await costRepository.associateComponent({ product_id: productId, cost_component_id: validated.cost_component_id, quantity: validated.quantity });
      results.product.push({ product_id: assoc.product_id });
    }
    for (const subgroupId of validated.subgroup_ids ?? []) {
      const subgroup = await productSubgroupRepository.findById(subgroupId);
      if (!subgroup) throw new NotFoundError(`Subgroup ${subgroupId} not found`);
      const assoc = await costRepository.associateSubgroup({ subgroup_id: subgroupId, cost_component_id: validated.cost_component_id, quantity: validated.quantity });
      results.subgroup.push({ subgroup_id: assoc.subgroup_id });
    }
    return results;
  }

  async associateSubgroupBatch(data: CostAssociateSubgroupBatch) {
    const validated = CostSchema.associateSubgroupBatch.parse(data);
    const subgroup = await productSubgroupRepository.findById(validated.subgroup_id);
    if (!subgroup) throw new NotFoundError('Subgroup not found');

    for (const componentId of validated.cost_component_ids) {
      const component = await costRepository.findComponentById(componentId);
      if (!component) throw new NotFoundError(`Cost component ${componentId} not found`);
    }

    const associations = await costRepository.associateSubgroupBatch(
      validated.subgroup_id,
      validated.cost_component_ids,
      validated.quantity
    );
    return { subgroup_id: validated.subgroup_id, associations };
  }

  async associateProductBatch(data: CostAssociateProductBatch) {
    const validated = CostSchema.associateProductBatch.parse(data);
    const product = await productRepository.findById(validated.product_id);
    if (!product) throw new NotFoundError('Product not found');

    for (const componentId of validated.cost_component_ids) {
      const component = await costRepository.findComponentById(componentId);
      if (!component) throw new NotFoundError(`Cost component ${componentId} not found`);
    }

    const associations = await costRepository.associateProductBatch(
      validated.product_id,
      validated.cost_component_ids,
      validated.quantity
    );
    return { product_id: validated.product_id, associations };
  }

  async deleteSubgroupAssociations(data: CostDeleteSubgroupAssociations) {
    const validated = CostSchema.deleteSubgroupAssociations.parse(data);
    const subgroup = await productSubgroupRepository.findById(validated.subgroup_id);
    if (!subgroup) throw new NotFoundError('Subgroup not found');
    return costRepository.hardDeleteSubgroupAssociations(validated.subgroup_id, validated.cost_component_ids);
  }
}

export const costService = new CostService();
