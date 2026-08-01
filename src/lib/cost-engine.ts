export type CostComponentType = "FIXED" | "PERCENT" | "PER_ORDER" | "MONTHLY";
export type CostComponentCategory =
  | "PACKAGING" | "TAX" | "FEE" | "SHIPPING" | "OPERATIONAL" | "MARKETING" | "OTHER";
export type CalculationBase = "PRICE" | "COST";

export interface CostComponentInput {
  id: string;
  name: string;
  type: CostComponentType;
  category: CostComponentCategory;
  value: number;
  calculation_base: CalculationBase;
  quantity: number; // association quantity
}

export interface CostEngineItemInput {
  variant_id: string;
  product_id: string;
  unit_price: number;
  quantity: number;
  product_cost: number; // variant.cost_price
  legacy_packaging_cost: number;
  legacy_platform_fee_percent: number;
  components: CostComponentInput[];
}

export interface CostBreakdownEntry {
  component_id: string | null;
  name: string;
  type: string;
  category: string;
  unit_value: number;
  quantity: number;
  line_total: number;
}

export interface ItemCostSnapshot {
  variant_id: string;
  unit_cost: number;
  unit_packaging_cost: number;
  unit_platform_fee: number;
  unit_tax: number;
  unit_shipping_cost: number;
  unit_operational_cost: number;
  unit_marketing_cost: number;
  unit_other_cost: number;
  unit_total_cost: number;
  unit_profit: number;
  margin_percent: number;
  cost_breakdown: CostBreakdownEntry[];
}

export interface OrderCostResult {
  items: ItemCostSnapshot[];
  total_cost: number;
  total_profit: number;
  margin_percent: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const categoryKey: Record<CostComponentCategory, keyof ItemCostSnapshot> = {
  PACKAGING: "unit_packaging_cost",
  TAX: "unit_tax",
  FEE: "unit_platform_fee",
  SHIPPING: "unit_shipping_cost",
  OPERATIONAL: "unit_operational_cost",
  MARKETING: "unit_marketing_cost",
  OTHER: "unit_other_cost",
};

interface ItemBaseCost {
  input: CostEngineItemInput;
  perUnit: Record<keyof typeof categoryKey, number>;
  breakdown: CostBreakdownEntry[];
  perOrderFees: Array<{ value: number; category: CostComponentCategory }>;
}

function computeItemBase(input: CostEngineItemInput): ItemBaseCost {
  const perUnit: Record<CostComponentCategory, number> = {
    PACKAGING: 0, TAX: 0, FEE: 0, SHIPPING: 0, OPERATIONAL: 0, MARKETING: 0, OTHER: 0,
  };
  const breakdown: CostBreakdownEntry[] = [];
  const perOrderFees: ItemBaseCost["perOrderFees"] = [];

  breakdown.push({
    component_id: null,
    name: "Custo do produto",
    type: "PRODUCT",
    category: "PRODUCT",
    unit_value: input.product_cost,
    quantity: 1,
    line_total: input.product_cost,
  });

  if (input.components.length === 0) {
    const packaging = input.legacy_packaging_cost || 0;
    const fee = input.legacy_platform_fee_percent
      ? (input.unit_price * input.legacy_platform_fee_percent) / 100
      : 0;
    perUnit.PACKAGING = packaging;
    perUnit.FEE = fee;
    if (packaging) breakdown.push({ component_id: null, name: "Embalagem (legado)", type: "FIXED", category: "PACKAGING", unit_value: packaging, quantity: 1, line_total: packaging });
    if (fee) breakdown.push({ component_id: null, name: "Taxa da plataforma (legado)", type: "PERCENT", category: "FEE", unit_value: fee, quantity: 1, line_total: fee });
    return { input, perUnit, breakdown, perOrderFees };
  }

  for (const c of input.components) {
    if (c.type === "MONTHLY") continue;

    if (c.type === "PER_ORDER") {
      perOrderFees.push({ value: c.value, category: c.category });
      breakdown.push({ component_id: c.id, name: c.name, type: c.type, category: c.category, unit_value: c.value, quantity: 1, line_total: c.value });
      continue;
    }

    let unitValue = 0;
    if (c.type === "FIXED") {
      unitValue = c.value * c.quantity;
    } else if (c.type === "PERCENT") {
      const base = c.calculation_base === "COST" ? input.product_cost : input.unit_price;
      unitValue = (base * c.value) / 100;
    }

    perUnit[c.category] += unitValue;
    breakdown.push({
      component_id: c.id, name: c.name, type: c.type, category: c.category,
      unit_value: unitValue, quantity: 1, line_total: unitValue,
    });
  }

  return { input, perUnit, breakdown, perOrderFees };
}

export function computeOrderCosts(
  items: CostEngineItemInput[],
  orderLevel: { shipping_cost_owner: number; discount_amount: number }
): OrderCostResult {
  const baseCosts = items.map(computeItemBase);
  const totalWeight = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);

  const totalPerOrderFees = baseCosts.reduce((sum, b) =>
    sum + b.perOrderFees.reduce((s, f) => s + f.value, 0), 0);
  const freight = orderLevel.shipping_cost_owner || 0;
  const orderLevelTotal = freight + totalPerOrderFees;

  const snapshots: ItemCostSnapshot[] = baseCosts.map((b) => {
    const { input } = b;
    const weight = input.unit_price * input.quantity;
    const share = totalWeight > 0 ? weight / totalWeight : 0;

    const perUnit: Record<CostComponentCategory, number> = {
      PACKAGING: b.perUnit.PACKAGING, TAX: b.perUnit.TAX, FEE: b.perUnit.FEE,
      SHIPPING: b.perUnit.SHIPPING, OPERATIONAL: b.perUnit.OPERATIONAL,
      MARKETING: b.perUnit.MARKETING, OTHER: b.perUnit.OTHER,
    };

    // allocate order-level costs (freight + per-order fees) by share
    if (share > 0) {
      perUnit.SHIPPING += round2(freight * share);
      for (const f of b.perOrderFees) {
        perUnit[f.category] += round2(f.value * share);
      }
    }

    const allocationBreakdown: CostBreakdownEntry[] = [];
    if (share > 0 && freight > 0) {
      allocationBreakdown.push({ component_id: null, name: "Frete (rateado)", type: "ALLOCATION", category: "SHIPPING", unit_value: round2(freight * share), quantity: 1, line_total: round2(freight * share) });
    }
    for (const f of b.perOrderFees) {
      allocationBreakdown.push({ component_id: null, name: f.value > 0 ? "Taxa por pedido (rateado)" : "", type: "ALLOCATION", category: f.category, unit_value: round2(f.value * share), quantity: 1, line_total: round2(f.value * share) });
    }

    const unit_total_cost = round2(
      input.product_cost + perUnit.PACKAGING + perUnit.TAX + perUnit.FEE +
      perUnit.SHIPPING + perUnit.OPERATIONAL + perUnit.MARKETING + perUnit.OTHER
    );

    const grossRevenue = input.unit_price * input.quantity;
    const discountShare = totalWeight > 0 ? (orderLevel.discount_amount || 0) * share : 0;
    const netUnitRevenue = (grossRevenue - discountShare) / input.quantity;
    const unit_profit = round2(netUnitRevenue - unit_total_cost);
    const margin_percent = netUnitRevenue > 0 ? round2((unit_profit / netUnitRevenue) * 100) : 0;

    return {
      variant_id: input.variant_id,
      unit_cost: input.product_cost,
      unit_packaging_cost: round2(perUnit.PACKAGING),
      unit_platform_fee: round2(perUnit.FEE),
      unit_tax: round2(perUnit.TAX),
      unit_shipping_cost: round2(perUnit.SHIPPING),
      unit_operational_cost: round2(perUnit.OPERATIONAL),
      unit_marketing_cost: round2(perUnit.MARKETING),
      unit_other_cost: round2(perUnit.OTHER),
      unit_total_cost,
      unit_profit,
      margin_percent,
      cost_breakdown: [...b.breakdown, ...allocationBreakdown],
    };
  });

  const exactTotalCost = items.reduce((sum, item, idx) => sum + snapshots[idx]!.unit_total_cost * item.quantity, 0);
  const orderTotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const netRevenue = orderTotal - (orderLevel.discount_amount || 0);
  const total_profit = round2(netRevenue - exactTotalCost);
  const margin_percent = netRevenue > 0 ? round2((total_profit / netRevenue) * 100) : 0;

  return { items: snapshots, total_cost: round2(exactTotalCost), total_profit, margin_percent };
}
