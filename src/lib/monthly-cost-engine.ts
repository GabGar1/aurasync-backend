export type MonthlyComponentType = "MONTHLY_FIXED" | "MONTHLY_PERCENT";
export type AllocationBasis = "PER_ORDER" | "PER_PRODUCT";

export interface MonthlyComponent {
  id: string;
  name: string;
  type: MonthlyComponentType;
  value: number;
  allocation_basis: AllocationBasis;
}

export interface MonthlyOrderRow {
  order_id: string;
  product_count: number;
}

export interface MonthlyAggregate {
  revenue: number;
  order_count: number;
  product_count: number;
  orders: MonthlyOrderRow[];
}

export interface MonthlyAllocation {
  order_id: string;
  cost_component_id: string;
  amount: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeMonthlyAllocations(
  components: MonthlyComponent[],
  agg: MonthlyAggregate
): MonthlyAllocation[] {
  const allocations: MonthlyAllocation[] = [];

  for (const c of components) {
    const total = c.type === "MONTHLY_PERCENT"
      ? (agg.revenue * c.value) / 100
      : c.value;

    if (agg.order_count === 0) continue;

    if (c.allocation_basis === "PER_PRODUCT") {
      if (agg.product_count === 0) continue;
      const perProduct = total / agg.product_count;
      for (const o of agg.orders) {
        const amount = round2(perProduct * o.product_count);
        if (amount === 0) continue;
        allocations.push({ order_id: o.order_id, cost_component_id: c.id, amount });
      }
    } else {
      const perOrder = total / agg.order_count;
      const base = round2(perOrder);
      const remainder = round2(total - base * agg.order_count);
      agg.orders.forEach((o, idx) => {
        const amount = idx === agg.orders.length - 1 ? base + remainder : base;
        if (amount === 0) return;
        allocations.push({ order_id: o.order_id, cost_component_id: c.id, amount });
      });
    }
  }

  return allocations;
}
