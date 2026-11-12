import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { fastifyRawBody } from "fastify-raw-body";
import { db } from "../lib/db.js";
import { errorHandler } from "../lib/error-handler.js";
import { webhookRoutes } from "../routers/webhook.router.js";
import { nuvemshopService } from "./nuvemshop.service.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";
import { startFakeNuvemshop, type FakeNuvemshop } from "../test/fake-nuvemshop.js";

const STORE_ID = "4242";
const SECRET = "test-app-secret";

const savedEnv = { ...process.env };
let fake: FakeNuvemshop;
let app: FastifyInstance;

const nuvemProduct = (id: number, variantId: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: { pt: `Produto ${id}` },
  categories: [{ name: { pt: "Pedras" } }],
  published: true,
  updated_at: "2026-11-10T10:00:00+0000",
  variants: [{ id: variantId, sku: `SKU-${variantId}`, price: "100.00", stock: 5, cost: "40.00" }],
  ...overrides,
});

const nuvemOrder = (id: number, variantId: number, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "open",
  payment_status: "paid",
  shipping_status: "unpacked",
  total: "200.00",
  contact_email: `cliente${id}@example.com`,
  customer: { name: `Cliente ${id}` },
  products: [{ variant_id: variantId, quantity: 2, price: "100.00" }],
  created_at: "2026-11-10T10:00:00+0000",
  updated_at: "2026-11-10T10:00:00+0000",
  ...overrides,
});

const sign = (body: string) => crypto.createHmac("sha256", SECRET).update(body).digest("hex");

const deliver = (payload: Record<string, unknown>, signature?: string | null) => {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-linkedstore-hmac-sha256"] = signature ?? sign(body);
  return app.inject({ method: "POST", url: "/api/webhooks/nuvemshop", payload: body, headers });
};

before(async () => {
  fake = await startFakeNuvemshop(STORE_ID);
  process.env.NUVEMSHOP_API_URL = fake.url;
  process.env.NUVEMSHOP_STORE_ID = STORE_ID;
  process.env.NUVEMSHOP_ACCESS_TOKEN = "test-token";
  process.env.NUVEMSHOP_WEBHOOK_SECRET = SECRET;

  app = Fastify();
  await app.register(fastifyRawBody, { field: "rawBody", global: false, encoding: "utf8", routes: ["/api/webhooks/nuvemshop"] });
  app.setErrorHandler(errorHandler);
  await app.register(webhookRoutes, { prefix: "/api/webhooks" });
  await app.ready();
});

after(async () => {
  await app.close();
  await fake.close();
  process.env = savedEnv;
  await cleanupDatabase();
  await closeDatabase();
});

beforeEach(async () => {
  fake.reset();
  await cleanupDatabase();
});

describe("Nuvemshop webhook", () => {
  it("rejects a delivery without the x-linkedstore-hmac-sha256 header", async () => {
    const res = await deliver({ store_id: Number(STORE_ID), event: "order/created", id: 1 }, null);
    assert.strictEqual(res.statusCode, 401);
  });

  it("rejects a delivery with a wrong signature", async () => {
    const res = await deliver({ store_id: Number(STORE_ID), event: "order/created", id: 1 }, sign("other body"));
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(fake.requests.length, 0);
  });

  it("rejects a signed body without event or id", async () => {
    const res = await deliver({ store_id: Number(STORE_ID) });
    assert.strictEqual(res.statusCode, 400);
  });

  it("product/created fetches the product by id and stores it mapped", async () => {
    fake.products.push(nuvemProduct(10, 100));
    const res = await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });

    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(fake.requests.map((r) => r.path), [`/v1/${STORE_ID}/products/10`]);
    const product = await db("products").where({ nuvemshop_id: "10" }).first();
    assert.strictEqual(product.name, "Produto 10");
    assert.strictEqual(product.category, "Pedras");
    const variant = await db("product_variants").where({ nuvemshop_variant_id: "100" }).first();
    assert.strictEqual(Number(variant.price), 100);
    assert.strictEqual(variant.stock_quantity, 5);
  });

  it("order/paid fetches the order and stores status, items and customer", async () => {
    fake.products.push(nuvemProduct(10, 100));
    fake.orders.push(nuvemOrder(500, 100));
    await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });

    const res = await deliver({ store_id: Number(STORE_ID), event: "order/paid", id: 500 });

    assert.strictEqual(res.statusCode, 200, res.body);
    const order = await db("orders").where({ nuvemshop_order_id: "500" }).first();
    assert.strictEqual(order.status, "PAID");
    assert.strictEqual(Number(order.total_amount), 200);
    const items = await db("order_items").where({ order_id: order.id, status: true });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].quantity, 2);
    const customer = await db("customers").where({ email: "cliente500@example.com" }).first();
    assert.ok(customer);
  });

  it("is idempotent: a redelivered event does not duplicate the order or its items", async () => {
    fake.products.push(nuvemProduct(10, 100));
    fake.orders.push(nuvemOrder(500, 100));
    await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });

    const payload = { store_id: Number(STORE_ID), event: "order/created", id: 500 };
    assert.strictEqual((await deliver(payload)).statusCode, 200);
    assert.strictEqual((await deliver(payload)).statusCode, 200);

    const orders = await db("orders").where({ nuvemshop_order_id: "500" });
    assert.strictEqual(orders.length, 1);
    const items = await db("order_items").where({ order_id: orders[0].id, status: true });
    assert.strictEqual(items.length, 1);
  });

  it("keeps the customer's first and last purchase dates when events arrive out of order", async () => {
    fake.products.push(nuvemProduct(10, 100));
    const email = "mesmo.cliente@example.com";
    fake.orders.push(
      nuvemOrder(600, 100, { contact_email: email, created_at: "2026-11-01T10:00:00+0000" }),
      nuvemOrder(601, 100, { contact_email: email, created_at: "2026-11-05T10:00:00+0000" }),
    );
    await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });

    await deliver({ store_id: Number(STORE_ID), event: "order/created", id: 601 });
    await deliver({ store_id: Number(STORE_ID), event: "order/created", id: 600 });

    const customer = await db("customers").where({ email }).first();
    assert.strictEqual(new Date(customer.first_purchase_at).toISOString(), "2026-11-01T10:00:00.000Z");
    assert.strictEqual(new Date(customer.last_purchase_at).toISOString(), "2026-11-05T10:00:00.000Z");
  });

  it("order/cancelled reflects the cancellation reported by the API", async () => {
    fake.products.push(nuvemProduct(10, 100));
    fake.orders.push(nuvemOrder(500, 100));
    await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });
    await deliver({ store_id: Number(STORE_ID), event: "order/created", id: 500 });

    fake.orders[0] = { ...fake.orders[0], status: "cancelled", cancelled_at: "2026-11-11T10:00:00+0000" };
    await deliver({ store_id: Number(STORE_ID), event: "order/cancelled", id: 500 });

    const order = await db("orders").where({ nuvemshop_order_id: "500" }).first();
    assert.strictEqual(order.status, "CANCELED");
  });

  it("product/deleted soft-deletes the local product and a later product/created restores it", async () => {
    fake.products.push(nuvemProduct(10, 100));
    await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });

    const deleted = await deliver({ store_id: Number(STORE_ID), event: "product/deleted", id: 10 });
    assert.strictEqual(deleted.statusCode, 200);
    let product = await db("products").where({ nuvemshop_id: "10" }).first();
    assert.ok(product.deleted_at, "product should be soft-deleted");
    assert.strictEqual(product.is_active, false);

    const restored = await deliver({ store_id: Number(STORE_ID), event: "product/created", id: 10 });
    assert.strictEqual(restored.statusCode, 200, restored.body);
    product = await db("products").where({ nuvemshop_id: "10" }).first();
    assert.strictEqual(product.deleted_at, null);
    assert.strictEqual(product.is_active, true);
    const variant = await db("product_variants").where({ nuvemshop_variant_id: "100" }).first();
    assert.strictEqual(variant.deleted_at, null);
  });

  it("acknowledges an update for a product that no longer exists on Nuvemshop without failing", async () => {
    const res = await deliver({ store_id: Number(STORE_ID), event: "product/updated", id: 999 });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.body).status, "ignored");
  });

  it("ignores events from another store and unknown events without calling the API", async () => {
    const otherStore = await deliver({ store_id: 1, event: "order/created", id: 500 });
    const unknown = await deliver({ store_id: Number(STORE_ID), event: "app/uninstalled", id: 1 });

    assert.strictEqual(otherStore.statusCode, 200);
    assert.strictEqual(JSON.parse(otherStore.body).status, "ignored");
    assert.strictEqual(unknown.statusCode, 200);
    assert.strictEqual(JSON.parse(unknown.body).status, "ignored");
    assert.strictEqual(fake.requests.length, 0);
  });

  it("answers with an error when the Nuvemshop API fails, so the delivery is retried", async () => {
    fake.orders.push(nuvemOrder(500, 100));
    fake.failNext = 5;
    const res = await deliver({ store_id: Number(STORE_ID), event: "order/created", id: 500 });
    assert.ok(res.statusCode >= 500, `expected 5xx, got ${res.statusCode}`);
    assert.strictEqual(await db("orders").where({ nuvemshop_order_id: "500" }).first(), undefined);
  });
});

describe("Nuvemshop sync", () => {
  it("pages through every product and stores all of them", async () => {
    for (let i = 1; i <= 205; i++) fake.products.push(nuvemProduct(i, 1000 + i));

    const result = await nuvemshopService.syncProducts();

    assert.strictEqual(result.processed, 205);
    assert.strictEqual(result.mode, "full");
    const row = await db("products").count("* as count").first();
    assert.strictEqual(Number(row?.count), 205);
    const listCalls = fake.requests.filter((r) => r.path === `/v1/${STORE_ID}/products`);
    assert.deepStrictEqual(listCalls.map((r) => r.query.page), ["1", "2"]);
    assert.ok(listCalls.every((r) => r.query.per_page === "200"));
  });

  it("maps order status through the shared mapper during sync", async () => {
    fake.products.push(nuvemProduct(10, 100));
    fake.orders.push(
      nuvemOrder(1, 100, { status: "closed", payment_status: "paid", shipping_status: "unpacked" }),
      nuvemOrder(2, 100, { status: "closed", payment_status: "paid", shipping_status: "delivered" }),
    );
    await nuvemshopService.syncProducts();

    await nuvemshopService.syncOrders();

    const statuses = Object.fromEntries(
      (await db("orders").select("nuvemshop_order_id", "status")).map((o) => [o.nuvemshop_order_id, o.status]),
    );
    assert.deepStrictEqual(statuses, { "1": "PAID", "2": "DELIVERED" });
  });

  it("runs incrementally after a successful sync and fully when asked", async () => {
    fake.products.push(nuvemProduct(1, 1001));
    await nuvemshopService.syncProducts();
    fake.requests = [];

    const incremental = await nuvemshopService.syncProducts();
    assert.strictEqual(incremental.mode, "incremental");
    const incrementalCall = fake.requests.find((r) => r.path === `/v1/${STORE_ID}/products`);
    assert.ok(incrementalCall?.query.updated_at_min, "incremental sync should send updated_at_min");
    fake.requests = [];

    const full = await nuvemshopService.syncProducts({ full: true });
    assert.strictEqual(full.mode, "full");
    const fullCall = fake.requests.find((r) => r.path === `/v1/${STORE_ID}/products`);
    assert.strictEqual(fullCall?.query.updated_at_min, undefined);
  });

  it("does not advance the incremental checkpoint when a sync fails", async () => {
    fake.products.push(nuvemProduct(1, 1001));
    fake.failNext = 1;
    await assert.rejects(() => nuvemshopService.syncProducts());

    fake.requests = [];
    const next = await nuvemshopService.syncProducts();
    assert.strictEqual(next.mode, "full");
  });

  it("refuses a second sync of the same kind while one is running", async () => {
    fake.products.push(nuvemProduct(1, 1001));
    fake.delayMs = 100;

    const first = nuvemshopService.syncProducts();
    assert.strictEqual(nuvemshopService.isSyncing("products"), true);
    await assert.rejects(() => nuvemshopService.syncProducts(), (err: any) => err.statusCode === 409);
    await first;
    assert.strictEqual(nuvemshopService.isSyncing("products"), false);
  });

  it("waits and retries when Nuvemshop answers 429", async () => {
    fake.products.push(nuvemProduct(1, 1001));
    fake.throttleNext = 2;

    const result = await nuvemshopService.syncProducts();

    assert.strictEqual(result.processed, 1);
    const listCalls = fake.requests.filter((r) => r.path === `/v1/${STORE_ID}/products`);
    assert.strictEqual(listCalls.length, 3);
  });
});
