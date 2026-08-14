import { describe, it } from "node:test";
import assert from "node:assert";
import { computeOrderCosts, type CostEngineItemInput } from "./cost-engine.js";

function baseItem(overrides: Partial<CostEngineItemInput> = {}): CostEngineItemInput {
  return {
    variant_id: "11111111-1111-1111-1111-111111111111",
    product_id: "22222222-2222-2222-2222-222222222222",
    subgroup_id: null,
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

  it("divides allocated freight by line quantity for per-unit cost", () => {
    const item = baseItem({ unit_price: 80, quantity: 2 });
    const result = computeOrderCosts([item], { shipping_cost_owner: 10, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_shipping_cost, 5); // 10 * 100% share / 2 qty
    assert.strictEqual(result.total_cost, 98.8); // (40 + 2 + 2.4 + 5) * 2
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

  it("ignores MONTHLY_FIXED components at sale time", () => {
    const item = baseItem({ components: [
      { id: "c1", name: "Contadora", type: "MONTHLY_FIXED", category: "OPERATIONAL", value: 500, calculation_base: "PRICE", quantity: 1 },
    ] });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_operational_cost, 0);
  });

  it("produces distinct snapshots for duplicate variant_ids aligned by index", () => {
    const items = [
      baseItem({ variant_id: "v-dup", unit_price: 100, quantity: 1, components: [] }),
      baseItem({ variant_id: "v-dup", unit_price: 200, quantity: 3, components: [] }),
    ];
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0]!.unit_platform_fee, 3); // 100 * 3%
    assert.strictEqual(result.items[1]!.unit_platform_fee, 6); // 200 * 3%
    assert.strictEqual(result.items[0]!.unit_total_cost, 45);
    assert.strictEqual(result.items[1]!.unit_total_cost, 48);
    assert.strictEqual(result.total_cost, 189); // 45 + 48 * 3
  });

  it("does not emit a zero-value allocation breakdown row when share is 0", () => {
    const item = baseItem({ unit_price: 0, components: [
      { id: "c1", name: "Taxa Plataforma", type: "PER_ORDER", category: "FEE", value: 10, calculation_base: "PRICE", quantity: 1 },
    ] });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    const breakdown = result.items[0]!.cost_breakdown;
    assert.ok(!breakdown.some(e => e.type === "ALLOCATION" || e.name.endsWith("(rateado)")));
  });

  it("uses ACQUISITION components as unit_cost instead of product_cost", () => {
    const item = baseItem({
      components: [
        { id: "c1", name: "Aquisição", type: "FIXED", category: "ACQUISITION", value: 10, calculation_base: "PRICE", quantity: 2 },
      ],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0 });
    assert.strictEqual(result.items[0]!.unit_cost, 20);
    assert.strictEqual(result.items[0]!.unit_total_cost, 20);
  });

  it("computes packaging boxes by capacity (no consolidation)", () => {
    const packaging = { id: "pk", name: "Caixa A", type: "PACKAGING" as const, category: "PACKAGING" as const, value: 3, calculation_base: "PRICE" as const, quantity: 1, max_products_per_package: 6 };
    const items = [1, 2, 3, 4, 5, 6, 7].map((n) => baseItem({
      variant_id: `v${n}`, subgroup_id: "sg-a", unit_price: 10, quantity: 1, components: [packaging],
    }));
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 0 });
    const totalPack = result.items.reduce((s, i) => s + i.unit_packaging_cost, 0);
    // ceil(7/6) = 2 boxes = 6; per-item rounding drift is a known quirk
    assert.ok(Math.abs(totalPack - 6) < 0.1);
    assert.ok(Math.abs(result.total_cost - 286) < 0.1);
  });

  it("consolidator packaging absorbs other packaging", () => {
    const packA = { id: "pkA", name: "Caixa A", type: "PACKAGING" as const, category: "PACKAGING" as const, value: 3, calculation_base: "PRICE" as const, quantity: 1, max_products_per_package: 6, consolidates: false };
    const packB = { id: "pkB", name: "Caixa B", type: "PACKAGING" as const, category: "PACKAGING" as const, value: 9, calculation_base: "PRICE" as const, quantity: 1, max_products_per_package: 6, consolidates: true };
    const items = [
      baseItem({ variant_id: "a1", subgroup_id: "sg-a", unit_price: 10, quantity: 5, components: [packA] }),
      baseItem({ variant_id: "b1", subgroup_id: "sg-b", unit_price: 10, quantity: 1, components: [packB] }),
    ];
    const result = computeOrderCosts(items, { shipping_cost_owner: 0, discount_amount: 0 });
    let totalPack = 0;
    result.items.forEach((s, idx) => { totalPack += s.unit_packaging_cost * items[idx]!.quantity; });
    assert.strictEqual(Math.round(totalPack * 100) / 100, 9);
  });

  it("applies credit fee by installments and total_amount", () => {
    const item = baseItem({
      unit_price: 100, quantity: 1,
      components: [{ id: "dummy", name: "X", type: "FIXED", category: "OTHER", value: 1, calculation_base: "PRICE", quantity: 1 }],
    });
    const result = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0, total_amount: 100, credit_fee: { percent: 5.19, fixed_fee: 0.35 } });
    assert.strictEqual(result.items[0]!.unit_platform_fee, 5.54);
  });

  it("applies fair-only components only when is_fair", () => {
    const fairComp = { id: "fair", name: "Custo feira", type: "FIXED" as const, category: "OTHER" as const, value: 5, calculation_base: "PRICE" as const, quantity: 1, applies_to_fair_only: true };
    const item = baseItem({ components: [fairComp] });
    const notFair = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0, is_fair: false });
    assert.strictEqual(notFair.items[0]!.unit_other_cost, 0);
    const fair = computeOrderCosts([item], { shipping_cost_owner: 0, discount_amount: 0, is_fair: true });
    assert.strictEqual(fair.items[0]!.unit_other_cost, 5);
  });
});
