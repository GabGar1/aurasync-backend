import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { costService } from "./cost.service.js";
import { productService } from "./product.service.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CostService Integration Tests", () => {
  let productId: string;
  let variantId: string;
  let componentId: string;
  let associationId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "cost-engine-test-product",
      name: "Cost Engine Test Product",
      variants: [{ price: 100, stock_quantity: 50, cost_price: 40, packaging_cost: 2, platform_fee_percent: 3 }],
    });
    productId = product.id;
    variantId = product.variants[0]!.id;
  });

  after(async () => {
    await cleanupDatabase();
    await closeDatabase();
  });

  it("creates a cost component", async () => {
    const component = await costService.createComponent({
      name: "Caixa P",
      description: "Caixa pequena de papelão",
      type: "FIXED",
      value: 1.5,
    });
    componentId = component.id;
    assert.ok(component.id);
    assert.strictEqual(component.name, "Caixa P");
    assert.strictEqual(component.category, "OTHER");
  });

  it("creates a PERCENT component and requires calculation_base", async () => {
    await assert.rejects(
      async () => costService.createComponent({ name: "Imposto", type: "PERCENT", value: 2.64 } as any),
      (err: Error) => err.message.includes("calculation_base") || err.message.includes("Invalid")
    );
    const component = await costService.createComponent({
      name: "Imposto", type: "PERCENT", value: 2.64, calculation_base: "PRICE",
    });
    assert.ok(component.id);
  });

  it("lists components", async () => {
    const components = await costService.listComponents();
    assert.ok(components.length >= 2);
  });

  it("updates a component", async () => {
    const updated = await costService.updateComponent(componentId, { value: 2.0 });
    assert.strictEqual(Number(updated!.value), 2.0);
  });

  it("associates a component with a product", async () => {
    const association = (await costService.associateComponent({
      product_id: productId,
      cost_component_id: componentId,
      quantity: 2,
    })) as unknown as { id: string; quantity: number; component: { name: string } };
    associationId = association.id;
    assert.ok(association.id);
    assert.strictEqual(Number(association.quantity), 2);
    assert.strictEqual(association.component.name, "Caixa P");
  });

  it("fails to associate with a non-existent product", async () => {
    await assert.rejects(
      async () => costService.associateComponent({
        product_id: "00000000-0000-4000-8000-000000000099",
        cost_component_id: componentId,
        quantity: 1,
      }),
      (err: Error) => err.message.includes("Product not found")
    );
  });

  it("simulates a cost composition using the engine", async () => {
    const result = await costService.simulateCosts({ variant_id: variantId, unit_price: 100, quantity: 1 });
    // Component "Caixa P" defaults to category OTHER, so the FIXED value routes
    // to unit_other_cost, not unit_packaging_cost. Legacy packaging cost is only
    // used when a product has no associated components.
    assert.strictEqual(Number(result!.unit_packaging_cost), 0);
    assert.strictEqual(Number(result!.unit_other_cost), 4); // 2.0 * 2 association qty
    assert.strictEqual(Number(result!.unit_total_cost), 44); // 40 + 4
  });

  it("removes an association", async () => {
    const removed = await costService.removeAssociation(associationId);
    assert.strictEqual(removed, true);
    const associations = await costService.getAssociationsByProduct(productId);
    assert.strictEqual(associations.length, 0);
  });

  it("soft-deletes a component", async () => {
    const deleted = await costService.deleteComponent(componentId);
    assert.strictEqual(deleted, true);
    const components = await costService.listComponents();
    assert.ok(!components.some(c => c.id === componentId));
  });
});
