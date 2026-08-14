import { describe, it } from "node:test";
import assert from "node:assert";
import { computeMonthlyAllocations } from "./monthly-cost-engine.js";

const orders = [
  { order_id: "o1", product_count: 2 },
  { order_id: "o2", product_count: 1 },
];

describe("MonthlyCostEngine", () => {
  it("distributes MONTHLY_FIXED equally by order", () => {
    const agg = { revenue: 1000, order_count: 2, product_count: 3, orders };
    const allocs = computeMonthlyAllocations([
      { id: "c1", name: "Equipe", type: "MONTHLY_FIXED", value: 100, allocation_basis: "PER_ORDER" },
    ], agg);
    assert.strictEqual(allocs.length, 2);
    assert.strictEqual(allocs.reduce((s, a) => s + a.amount, 0), 100);
    assert.strictEqual(allocs.find(a => a.order_id === "o1")!.amount, 50);
  });

  it("distributes MONTHLY_FIXED by product", () => {
    const agg = { revenue: 1000, order_count: 2, product_count: 3, orders };
    const allocs = computeMonthlyAllocations([
      { id: "c1", name: "Equipe", type: "MONTHLY_FIXED", value: 300, allocation_basis: "PER_PRODUCT" },
    ], agg);
    assert.strictEqual(allocs.find(a => a.order_id === "o1")!.amount, 200);
    assert.strictEqual(allocs.find(a => a.order_id === "o2")!.amount, 100);
  });

  it("computes MONTHLY_PERCENT over revenue", () => {
    const agg = { revenue: 1000, order_count: 2, product_count: 3, orders };
    const allocs = computeMonthlyAllocations([
      { id: "c2", name: "Imposto", type: "MONTHLY_PERCENT", value: 10, allocation_basis: "PER_ORDER" },
    ], agg);
    assert.strictEqual(allocs.reduce((s, a) => s + a.amount, 0), 100);
  });

  it("returns empty when there are no orders", () => {
    const agg = { revenue: 0, order_count: 0, product_count: 0, orders: [] };
    const allocs = computeMonthlyAllocations([
      { id: "c1", name: "Equipe", type: "MONTHLY_FIXED", value: 100, allocation_basis: "PER_ORDER" },
    ], agg);
    assert.strictEqual(allocs.length, 0);
  });
});
