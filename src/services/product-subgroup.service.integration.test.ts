import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { productSubgroupService } from "./product-subgroup.service.js";
import { productService } from "./product.service.js";
import { ProductSchema } from "../schemas/product.schema.js";
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

  it("lists products of a subgroup (paginated)", async () => {
    const listSg = await productSubgroupService.createSubgroup({ name: "Subgrupo List" });
    const [p1] = await db('products').insert({ slug: 'sg-list-1', name: 'Anel Solitário' }).returning('*');
    const [p2] = await db('products').insert({ slug: 'sg-list-2', name: 'Anel Tripla' }).returning('*');
    await productSubgroupService.assignProductsToSubgroup(listSg.id, [p1.id, p2.id]);

    const all = await productSubgroupService.listProducts(listSg.id, 1, 10);
    assert.strictEqual(all.total, 2);
    assert.ok(all.products.some((p: any) => p.id === p1.id));

    const searched = await productSubgroupService.listProducts(listSg.id, 1, 10, 'Tripla');
    assert.strictEqual(searched.total, 1);
    assert.strictEqual(searched.products[0].id, p2.id);
  });

  it("unassigns a product from a subgroup", async () => {
    const [p1] = await db('products').insert({ slug: 'sg-unassign', name: 'P' }).returning('*');
    await productSubgroupService.assignProductsToSubgroup(subgroupId, [p1.id]);

    const removed = await productSubgroupService.unassignProduct(subgroupId, p1.id);
    assert.strictEqual(removed, true);

    const after = await productSubgroupService.listProducts(subgroupId, 1, 10);
    assert.ok(!after.products.some((p: any) => p.id === p1.id));

    const notRemoved = await productSubgroupService.unassignProduct(subgroupId, p1.id);
    assert.strictEqual(notRemoved, false);
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

  it("clears subgroup_id from products when a subgroup is soft-deleted", async () => {
    const sg = await productSubgroupService.createSubgroup({ name: "Subgrupo Clear" });
    const [p1] = await db('products').insert({ slug: 'sg-clear-1', name: 'C1' }).returning('*');
    const [p2] = await db('products').insert({ slug: 'sg-clear-2', name: 'C2' }).returning('*');
    await productSubgroupService.assignProductsToSubgroup(sg.id, [p1.id, p2.id]);

    await productSubgroupService.deleteSubgroup(sg.id);

    const r1 = await db('products').where({ id: p1.id }).first();
    const r2 = await db('products').where({ id: p2.id }).first();
    assert.strictEqual(r1.subgroup_id, null);
    assert.strictEqual(r2.subgroup_id, null);
  });

  it("exposes subgroup_id on products after assignment", async () => {
    const sg = await productSubgroupService.createSubgroup({ name: "Subgrupo Expose" });
    const [product] = await db('products').insert({ slug: 'sg-expose', name: 'Expose' }).returning('*');
    await productSubgroupService.assignProductsToSubgroup(sg.id, [product.id]);
    const result: any = await productService.getProducts(1, 10, {});
    const found = result.products.find((p: any) => p.id === product.id);
    assert.ok(found);
    assert.strictEqual(found.subgroup_id, sg.id);

    const parsed = ProductSchema.response.parse({ ...found, variants: found.variants });
    assert.strictEqual(parsed.subgroup_id, sg.id);
    const parsedList = ProductSchema.listResponse.parse({ products: [{ ...found, variants: found.variants }], total: 1, page: 1, limit: 10 });
    assert.strictEqual(parsedList.products[0]!.subgroup_id, sg.id);
  });
});
