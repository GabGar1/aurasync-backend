import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { creditFeeService } from "./credit-fee.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CreditFeeService Integration Tests", () => {
  before(async () => {
    await cleanupDatabase();
    await db('credit_fee_tiers').insert([
      { installments: 1, percent: 5.19, fixed_fee: 0.35 },
      { installments: 2, percent: 6.38, fixed_fee: 0 },
      { installments: 3, percent: 7.76, fixed_fee: 0 },
    ]);
  });
  after(async () => { await cleanupDatabase(); await closeDatabase(); });

  it("lists seeded tiers (1x/2x/3x)", async () => {
    const tiers = await creditFeeService.listTiers();
    assert.strictEqual(tiers.length, 3);
    const one = tiers.find((t: any) => Number(t.installments) === 1)!;
    assert.strictEqual(Number(one.percent), 5.19);
    assert.strictEqual(Number(one.fixed_fee), 0.35);
  });

  it("updates a tier without affecting others", async () => {
    const tiers = await creditFeeService.listTiers();
    const two = tiers.find((t: any) => Number(t.installments) === 2)!;
    await creditFeeService.updateTier(two.id, { percent: 6.99 });
    const updated = await creditFeeService.listTiers();
    const found = updated.find((t: any) => t.id === two.id)!;
    assert.strictEqual(Number(found.percent), 6.99);
  });
});
