import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { dashboardService } from "./dashboard.service.js";
import { dashboardRoutes } from "../routers/dashboard.router.js";
import { errorHandler } from "../lib/error-handler.js";
import { db } from "../lib/db.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

let variantId: string;

async function insertOrder(fields: Record<string, unknown>, items: Array<{ variant_id: string | null; quantity: number }> = []) {
  const [order] = await db("orders")
    .insert({ customer_name: "Cliente", status: "PAID", total_amount: 100, created_at: new Date(), ...fields })
    .returning("*");
  for (const item of items) {
    await db("order_items").insert({ order_id: order.id, variant_id: item.variant_id, quantity: item.quantity, unit_price: 50, status: true });
  }
  return order;
}

before(async () => { await cleanupDatabase(); });
after(async () => { await cleanupDatabase(); await closeDatabase(); });

beforeEach(async () => {
  await cleanupDatabase();
  const [product] = await db("products").insert({ slug: "metrics", name: "Metrics", category: "Pedras", is_active: true }).returning("*");
  // updated_at = now, as after any Nuvemshop sync: it must not be read as "last sale".
  const [variant] = await db("product_variants")
    .insert({ product_id: product.id, name: "Unica", price: 50, stock_quantity: 8, created_at: daysAgo(400), updated_at: new Date() })
    .returning("*");
  variantId = variant.id;
});

describe("Dashboard metrics", () => {
  it("counts how many customers bought more than once (B7)", async () => {
    for (let i = 0; i < 3; i++) await insertOrder({ customer_email: "ana@example.com" });
    for (let i = 0; i < 3; i++) await insertOrder({ customer_email: "bia@example.com" });
    await insertOrder({ customer_email: "caio@example.com" });

    const stats = await dashboardService.getOrdersStats(30);

    assert.strictEqual(stats.repeat_customers.unique_customers, 3);
    assert.strictEqual(stats.repeat_customers.repeat_customers, 2);
    assert.strictEqual(stats.repeat_customers.repeat_rate, 0.67);
  });

  it("measures days without sale from the last sale, not from the last sync (B10)", async () => {
    await insertOrder({ created_at: daysAgo(100) }, [{ variant_id: variantId, quantity: 1 }]);

    const stats = await dashboardService.getStockStats(30);

    const dead = stats.dead_stock.find((d: any) => d.variant_name === "Unica");
    assert.ok(dead, "variant without sales for 100 days must be dead stock");
    assert.strictEqual(dead.days_without_sale, 100);
  });

  it("uses the variant creation date when it never sold (B10)", async () => {
    const stats = await dashboardService.getStockStats(30);
    const dead = stats.dead_stock.find((d: any) => d.variant_name === "Unica");
    assert.strictEqual(dead?.days_without_sale, 400);
  });

  it("an order item without variant does not hide every product without sales (B11)", async () => {
    await insertOrder({}, [{ variant_id: null, quantity: 1 }]);

    const stats = await dashboardService.getStockStats(30);

    assert.ok(stats.no_sales_30d.some((v: any) => v.variant_name === "Unica"));
    assert.ok(stats.dead_stock.some((v: any) => v.variant_name === "Unica"));
  });

  it("does not list a variant that sold inside the window", async () => {
    await insertOrder({ created_at: daysAgo(3) }, [{ variant_id: variantId, quantity: 1 }]);
    const stats = await dashboardService.getStockStats(30);
    assert.strictEqual(stats.no_sales_30d.length, 0);
    assert.strictEqual(stats.dead_stock.length, 0);
  });
});

describe("Dashboard routes (B13)", () => {
  let app: FastifyInstance;
  let token: string;

  before(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);
    await app.register(fastifyJwt, { secret: "test-secret" });
    app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
      try { await request.jwtVerify(); } catch { reply.status(401).send({ error: "Unauthorized" }); }
    });
    await app.register(dashboardRoutes, { prefix: "/api" });
    token = app.jwt.sign({ sub: "admin", role: "ADMIN", name: "Admin" });
  });

  after(async () => { await app.close(); });

  const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  it("uses the requested days on /dashboard/stock", async () => {
    await insertOrder({ created_at: daysAgo(10) }, [{ variant_id: variantId, quantity: 1 }]);

    const last5 = await get("/api/dashboard/stock?days=5");
    const last30 = await get("/api/dashboard/stock?days=30");

    assert.strictEqual(last5.statusCode, 200, last5.body);
    assert.strictEqual(last5.json().no_sales_30d.length, 1, "no sale in the last 5 days");
    assert.strictEqual(last30.json().no_sales_30d.length, 0, "sold 10 days ago");
  });

  it("rejects days outside 1..365", async () => {
    for (const url of ["/api/dashboard/stock?days=0", "/api/dashboard/orders?days=5000", "/api/dashboard/marketing?days=-3", "/api/dashboard/orders?days=2.5"]) {
      const res = await get(url);
      assert.strictEqual(res.statusCode, 400, `${url} -> ${res.statusCode}`);
    }
  });
});
