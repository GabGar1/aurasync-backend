import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { productSubgroupService } from "./product-subgroup.service.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("ProductSubgroupService Integration Tests", () => {
  let subgroupId: string;

  before(async () => { await cleanupDatabase(); });
  after(async () => { await cleanupDatabase(); await closeDatabase(); });

  it("creates a subgroup", async () => {
    const sg = await productSubgroupService.createSubgroup({ name: "Anéis", description: "Anéis pequenos" });
    subgroupId = sg.id;
    assert.ok(sg.id);
    assert.strictEqual(sg.name, "Anéis");
    assert.strictEqual(sg.is_active, true);
  });

  it("lists subgroups", async () => {
    const list = await productSubgroupService.listSubgroups();
    assert.ok(list.some((s: any) => s.id === subgroupId));
  });

  it("assigns products to a subgroup in batch", async () => {
    const [p1] = await db('products').insert({ slug: 'sg-p1', name: 'P1' }).returning('*');
    const [p2] = await db('products').insert({ slug: 'sg-p2', name: 'P2' }).returning('*');
    await productSubgroupService.assignProductsToSubgroup(subgroupId, [p1.id, p2.id]);
    const r1 = await db('products').where({ id: p1.id }).first();
    const r2 = await db('products').where({ id: p2.id }).first();
    assert.strictEqual(r1.subgroup_id, subgroupId);
    assert.strictEqual(r2.subgroup_id, subgroupId);
  });

  it("updates a subgroup", async () => {
    const updated = await productSubgroupService.updateSubgroup(subgroupId, { name: "Anéis e Alianças" });
    assert.strictEqual(updated!.name, "Anéis e Alianças");
  });

  it("soft-deletes a subgroup", async () => {
    const deleted = await productSubgroupService.deleteSubgroup(subgroupId);
    assert.strictEqual(deleted, true);
    const list = await productSubgroupService.listSubgroups();
    assert.ok(!list.some((s: any) => s.id === subgroupId));
  });
});
