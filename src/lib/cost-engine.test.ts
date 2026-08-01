import { describe, it } from "node:test";
import assert from "node:assert";
import { computeOrderCosts, type CostEngineItemInput } from "./cost-engine.js";

function baseItem(overrides: Partial<CostEngineItemInput> = {}): CostEngineItemInput {
  return {
    variant_id: "11111111-1111-1111-1111-111111111111",
    product_id: "22222222-2222-2222-2222-222222222222",
    unit_price: 100,
    quantity: 1,
    product_cost: 40,
    legacy_packaging_cost: 2,
    legacy_platform_fee_percent: 3,
    components: [],
    ...overrides,
  };
}

describe("CostEngine", () => {
  it("applies legacy fallback when no components are configured", () => {
    const result = computeOrderCosts([baseItem()], { shipping_cost_owner: 0, discount_amount: 0 });
    const item = result.items[0]!;
    assert.strictEqual(item.unit_cost, 40);
    assert.strictEqual(item.unit_packaging_cost, 2);
    assert.strictEqual(item.unit_platform_fee, 3); // 100 * 3%
    assert.strictEqual(item.unit_total_cost, 45);
    assert.strictEqual(item.unit_profit, 55);
    assert.strictEqual(item.margin_percent, 55);
  });

  it("computes FIXED components with association quantity routed by category", () => {
    const item = baseItem({
      components: [
        { id: "c1", name: "Caixa P", type: "FIXED", category: "PACKAGING", value: 1.5, calculation_base: "PRICE", quantity: 2 },
      ],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_packaging_cost, 3); // 1.5 * 2
    assert.strictEqual(result.items[0]!.unit_platform_fee, 0); // no legacy when components exist
  });

  it("computes PERCENT components on PRICE and COST bases", () => {
    const item = baseItem({
      components: [
        { id: "c1", name: "Imposto", type: "PERCENT", category: "TAX", value: 2.64, calculation_base: "PRICE", quantity: 1 },
        { id: "c2", name: "Comissão", type: "PERCENT", category: "FEE", value: 5, calculation_base: "COST", quantity: 1 },
      ],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_tax, 2.64); // 100 * 2.64%
    assert.strictEqual(result.items[0]!.unit_platform_fee, 2); // 40 * 5%
  });

  it("allocates PER_ORDER components and freight proportionally", () => {
    const items = [
      baseItem({ variant_id: "v1", unit_price: 100, quantity: 1, components: [] }),
      baseItem({ variant_id: "v2", unit_price: 300, quantity: 1, components: [
        { id: "c1", name: "Taxa Plataforma", type: "PER_ORDER", category: "FEE", value: 10, calculation_base: "PRICE", quantity: 1 },
      ] }),
    ];
    // weight v1=100, v2=300; total 400. freight=20, per-order fee=10 → allocated 30
    const result = computeOrderCosts(items, { shipping_cost_owner: 20, discount_amount: 0 });
    const v1 = result.items.find(i => i.variant_id === "v1")!;
    const v2 = result.items.find(i => i.variant_id === "v2")!;
    assert.strictEqual(v1.unit_shipping_cost, 5); // 20 * 25%
    assert.strictEqual(v2.unit_shipping_cost, 15);
    assert.strictEqual(v2.unit_platform_fee, 7.5); // 10 * 75%
    assert.strictEqual(v1.unit_platform_fee, 5.5); // 3 legacy + 10 * 25%
    assert.strictEqual(v1.unit_total_cost, 52.5);
    assert.strictEqual(v2.unit_total_cost, 62.5);
    assert.strictEqual(result.total_cost, 115); // 40+2+3+10+20 for 2 items
  });

  it("allocates discount proportionally for item profit", () => {
    const items = [
      baseItem({ variant_id: "v1", unit_price: 100, quantity: 1, components: [] }),
      baseItem({ variant_id: "v2", unit_price: 300, quantity: 1, components: [] }),
    ];
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 40 });
    const v1 = result.items.find(i => i.variant_id === "v1")!;
    assert.strictEqual(v1.unit_profit, 45); // 100 - 10 (25% of 40) - 45
  });

  it("ignores MONTHLY components", () => {
    const item = baseItem({ components: [
      { id: "c1", name: "Contadora", type: "MONTHLY", category: "OPERATIONAL", value: 500, calculation_base: "PRICE", quantity: 1 },
    ] });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_operational_cost, 0);
  });
});
