export type CostComponentType =
  | "FIXED" | "PERCENT" | "PER_ORDER" | "PACKAGING" | "MONTHLY_FIXED" | "MONTHLY_PERCENT";
export type CostComponentCategory =
  | "PACKAGING" | "TAX" | "FEE" | "SHIPPING" | "OPERATIONAL"
  | "MARKETING" | "OTHER" | "ACQUISITION" | "CREDIT_FEE";
export type CalculationBase = "PRICE" | "COST";

type SnapshotCategory = "PACKAGING" | "TAX" | "FEE" | "SHIPPING" | "OPERATIONAL" | "MARKETING" | "OTHER";

export interface CostComponentInput {
  id: string;
  name: string;
  type: CostComponentType;
  category: CostComponentCategory;
  value: number;
  calculation_base: CalculationBase;
  quantity: number;
  max_products_per_package?: number | null;
  consolidates?: boolean;
  applies_to_fair_only?: boolean;
}

export interface CostEngineItemInput {
  variant_id: string;
  product_id: string;
  subgroup_id?: string | null;
  unit_price: number;
  quantity: number;
  product_cost: number;
  legacy_packaging_cost: number;
  legacy_platform_fee_percent: number;
  components: CostComponentInput[];
}

export interface OrderLevelInput {
  shipping_cost_owner: number;
  discount_amount: number;
  is_fair?: boolean;
  credit_fee?: { percent: number; fixed_fee: number } | null;
  total_amount?: number;
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

interface PerOrderFee {
  id: string | null;
  value: number;
  category: SnapshotCategory;
  name: string;
}

interface ItemBaseCost {
  input: CostEngineItemInput;
  acquisition: number;
  perUnit: Record<SnapshotCategory, number>;
  breakdown: CostBreakdownEntry[];
  perOrderFees: PerOrderFee[];
}

function computeItemBase(input: CostEngineItemInput, isFair: boolean): ItemBaseCost {
  const perUnit: Record<SnapshotCategory, number> = {
    PACKAGING: 0, TAX: 0, FEE: 0, SHIPPING: 0, OPERATIONAL: 0, MARKETING: 0, OTHER: 0,
  };
  let acquisition = 0;
  const breakdown: CostBreakdownEntry[] = [];
  const perOrderFees: PerOrderFee[] = [];

  const acquisitionComponents = input.components.filter(
    (c) => c.type === "FIXED" && c.category === "ACQUISITION" && !(c.applies_to_fair_only && !isFair)
  );

  if (acquisitionComponents.length > 0) {
    for (const c of acquisitionComponents) {
      const unitValue = c.value * c.quantity;
      acquisition += unitValue;
      breakdown.push({ component_id: c.id, name: c.name, type: "FIXED", category: "ACQUISITION", unit_value: unitValue, quantity: 1, line_total: unitValue });
    }
  } else {
    acquisition = input.product_cost;
    breakdown.push({ component_id: null, name: "Custo do produto", type: "PRODUCT", category: "PRODUCT", unit_value: input.product_cost, quantity: 1, line_total: input.product_cost });
  }

  if (input.components.length === 0) {
    const packaging = input.legacy_packaging_cost || 0;
    const fee = input.legacy_platform_fee_percent
      ? (input.unit_price * input.legacy_platform_fee_percent) / 100
      : 0;
    perUnit.PACKAGING = packaging;
    perUnit.FEE = fee;
    if (packaging) breakdown.push({ component_id: null, name: "Embalagem (legado)", type: "FIXED", category: "PACKAGING", unit_value: packaging, quantity: 1, line_total: packaging });
    if (fee) breakdown.push({ component_id: null, name: "Taxa da plataforma (legado)", type: "PERCENT", category: "FEE", unit_value: fee, quantity: 1, line_total: fee });
    return { input, acquisition, perUnit, breakdown, perOrderFees };
  }

  for (const c of input.components) {
    if (c.type === "MONTHLY_FIXED" || c.type === "MONTHLY_PERCENT" || c.type === "PACKAGING") continue;
    if (c.applies_to_fair_only && !isFair) continue;
    if (c.type === "FIXED" && c.category === "ACQUISITION") continue;

    if (c.type === "PER_ORDER") {
      perOrderFees.push({ id: c.id, value: c.value, category: (c.category as SnapshotCategory), name: c.name });
      continue;
    }

    let unitValue = 0;
    if (c.type === "FIXED") {
      unitValue = c.value * c.quantity;
    } else if (c.type === "PERCENT") {
      const base = c.calculation_base === "COST" ? input.product_cost : input.unit_price;
      unitValue = (base * c.value) / 100;
    }

    if (c.category === "ACQUISITION") {
      acquisition += unitValue;
    } else {
      perUnit[c.category as SnapshotCategory] += unitValue;
    }
    breakdown.push({ component_id: c.id, name: c.name, type: c.type, category: c.category, unit_value: unitValue, quantity: 1, line_total: unitValue });
  }

  return { input, acquisition, perUnit, breakdown, perOrderFees };
}

interface PackagingBox {
  component_id: string;
  name: string;
  boxes: number;
  cost: number;
}

function computePackaging(items: CostEngineItemInput[], isFair: boolean): { totalCost: number; boxes: PackagingBox[] } {
  const bySubgroup = new Map<string, { component: CostComponentInput; qty: number }>();

  for (const item of items) {
    for (const c of item.components) {
      if (c.type !== "PACKAGING") continue;
      if (c.applies_to_fair_only && !isFair) continue;
      const key = item.subgroup_id ?? "";
      const existing = bySubgroup.get(key);
      if (existing) existing.qty += item.quantity;
      else bySubgroup.set(key, { component: c, qty: item.quantity });
    }
  }

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const entries = [...bySubgroup.values()];

  const consolidators = entries.filter((e) => e.component.consolidates && e.qty > 0);
  if (consolidators.length > 0) {
    const best = consolidators.reduce((a, b) =>
      ((b.component.max_products_per_package ?? 0) > (a.component.max_products_per_package ?? 0) ? b : a));
    const capacity = Math.max(best.component.max_products_per_package ?? 1, 1);
    const boxes = Math.ceil(totalQty / capacity);
    const cost = round2(boxes * best.component.value);
    return { totalCost: cost, boxes: [{ component_id: best.component.id, name: best.component.name, boxes, cost }] };
  }

  let totalCost = 0;
  const boxes: PackagingBox[] = [];
  for (const e of entries) {
    if (e.qty === 0) continue;
    const capacity = Math.max(e.component.max_products_per_package ?? 1, 1);
    const b = Math.ceil(e.qty / capacity);
    const cost = round2(b * e.component.value);
    totalCost += cost;
    boxes.push({ component_id: e.component.id, name: e.component.name, boxes: b, cost });
  }
  return { totalCost: round2(totalCost), boxes };
}

export function computeOrderCosts(
  items: CostEngineItemInput[],
  orderLevel: OrderLevelInput
): OrderCostResult {
  const isFair = orderLevel.is_fair ?? false;
  const baseCosts = items.map((i) => computeItemBase(i, isFair));
  const totalWeight = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
  const freight = orderLevel.shipping_cost_owner || 0;

  const packaging = computePackaging(items, isFair);

  const creditFee = orderLevel.credit_fee
    ? round2((orderLevel.total_amount ?? 0) * orderLevel.credit_fee.percent / 100 + orderLevel.credit_fee.fixed_fee)
    : 0;

  const allPerOrderFees: PerOrderFee[] = baseCosts.reduce((acc, b) => acc.concat(b.perOrderFees), [] as PerOrderFee[]);
  if (creditFee > 0) allPerOrderFees.push({ id: null, value: creditFee, category: "FEE", name: "Taxa de crédito" });

  const snapshots: ItemCostSnapshot[] = baseCosts.map((b) => {
    const { input } = b;
    const weight = input.unit_price * input.quantity;
    const share = totalWeight > 0 ? weight / totalWeight : 0;

    const perUnit: Record<SnapshotCategory, number> = { ...b.perUnit };

    if (share > 0) {
      perUnit.SHIPPING += round2((freight * share) / input.quantity);
      perUnit.PACKAGING += round2((packaging.totalCost * share) / input.quantity);
    }
    for (const f of allPerOrderFees) {
      perUnit[f.category] += round2((f.value * share) / input.quantity);
    }

    const allocationBreakdown: CostBreakdownEntry[] = [];
    if (share > 0 && freight > 0) {
      const freightAllocation = round2((freight * share) / input.quantity);
      allocationBreakdown.push({ component_id: null, name: "Frete (rateado)", type: "ALLOCATION", category: "SHIPPING", unit_value: freightAllocation, quantity: 1, line_total: freightAllocation });
    }
    if (share > 0 && packaging.totalCost > 0) {
      const packAlloc = round2((packaging.totalCost * share) / input.quantity);
      allocationBreakdown.push({ component_id: null, name: "Embalagem (rateado)", type: "ALLOCATION", category: "PACKAGING", unit_value: packAlloc, quantity: 1, line_total: packAlloc });
    }
    for (const f of allPerOrderFees) {
      const allocated = round2((f.value * share) / input.quantity);
      if (allocated === 0) continue;
      allocationBreakdown.push({ component_id: f.id, name: `${f.name} (rateado)`, type: "ALLOCATION", category: f.category, unit_value: allocated, quantity: 1, line_total: allocated });
    }

    const unit_total_cost = round2(
      b.acquisition + perUnit.PACKAGING + perUnit.TAX + perUnit.FEE +
      perUnit.SHIPPING + perUnit.OPERATIONAL + perUnit.MARKETING + perUnit.OTHER
    );

    const grossRevenue = input.unit_price * input.quantity;
    const discountShare = totalWeight > 0 ? (orderLevel.discount_amount || 0) * share : 0;
    const netUnitRevenue = input.quantity > 0 ? (grossRevenue - discountShare) / input.quantity : 0;
    const unit_profit = round2(netUnitRevenue - unit_total_cost);
    const margin_percent = netUnitRevenue > 0 ? round2((unit_profit / netUnitRevenue) * 100) : 0;

    return {
      variant_id: input.variant_id,
      unit_cost: round2(b.acquisition),
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
