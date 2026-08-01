import { costRepository } from '../repositories/cost.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { CostSchema, type CostComponentCreate, type CostComponentUpdate, type CostAssociationCreate, type CostSimulateInput } from '../schemas/cost.schema.js';
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
      type: c.type as 'FIXED' | 'PERCENT' | 'PER_ORDER' | 'MONTHLY',
      category: c.category as 'PACKAGING' | 'TAX' | 'FEE' | 'SHIPPING' | 'OPERATIONAL' | 'MARKETING' | 'OTHER',
      value: Number(c.value),
      calculation_base: c.calculation_base as 'PRICE' | 'COST',
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
}

export const costService = new CostService();
