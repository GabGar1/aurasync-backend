/**
 * Demo store for the portfolio: `npm run db:seed:demo`
 *
 * - Only runs against a database whose name ends with "_demo" (it wipes that database).
 * - Creates the database if needed and applies the migrations.
 * - Writes everything through the real services, so costs, stock, customers and the
 *   monthly closing follow the production rules.
 * - The demo users' password comes from DEMO_PASSWORD (never committed).
 */
import "dotenv/config";
import knex from "knex";
import bcrypt from "bcrypt";
import { assertDemoDatabase, buildDemoCatalog, buildDemoOrders, createRng } from "./demo/demo-data.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
const DEMO_USERS = [
  { email: "demo@aurasync.dev", first_name: "Gabriela", last_name: "Demo", role: "SUPER_ADMIN" },
  { email: "funcionario@aurasync.dev", first_name: "Rafael", last_name: "Demo", role: "EMPLOYEE" },
] as const;

async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  target.pathname = "/postgres";
  const admin = knex({ client: "pg", connection: target.toString() });
  try {
    const exists = await admin.raw("SELECT 1 FROM pg_database WHERE datname = ?", [name]);
    if (exists.rows.length === 0) {
      await admin.raw(`CREATE DATABASE "${name}"`);
      console.log(`Created database ${name}`);
    }
  } finally {
    await admin.destroy();
  }
}

async function main() {
  assertDemoDatabase(DATABASE_URL);
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) {
    throw new Error("Set DEMO_PASSWORD (8+ characters) for the demo users.");
  }
  await ensureDatabase(DATABASE_URL!);

  // Imported after the database exists: these modules open the pool on import.
  const { db } = await import("../lib/db.js");
  const { productService } = await import("../services/product.service.js");
  const { productSubgroupService } = await import("../services/product-subgroup.service.js");
  const { costService } = await import("../services/cost.service.js");
  const { creditFeeService } = await import("../services/credit-fee.service.js");
  const { orderService } = await import("../services/order.service.js");
  const { externalSaleService } = await import("../services/external-sale.service.js");
  const { inventoryService } = await import("../services/inventory.service.js");
  const { costClosingService } = await import("../services/cost-closing.service.js");
  const { mapNuvemshopOrder } = await import("../lib/nuvemshop-mapper.js");

  try {
    await db.migrate.latest();

    console.log("Resetting demo data…");
    const tables = [
      "order_monthly_allocations", "inventory_transactions", "order_items", "orders", "product_variants",
      "products", "subgroup_cost_components", "product_cost_components", "cost_components", "credit_fee_tiers",
      "product_subgroups", "customers", "integration_sync_state", "users",
    ];
    for (const table of tables) await db.raw(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);

    const password_hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    await db("users").insert(DEMO_USERS.map((u) => ({ ...u, password_hash, status: true })));

    for (const [installments, percent, fixed_fee] of [[1, 4.99, 0.39], [2, 6.49, 0], [3, 7.99, 0], [6, 10.99, 0]] as const) {
      await creditFeeService.createTier({ installments, percent, fixed_fee });
    }

    const packaging = await costService.createComponent({ name: "Embalagem e etiqueta", type: "FIXED", category: "PACKAGING", value: 3.5 } as any);
    const platform = await costService.createComponent({ name: "Taxa da plataforma", type: "PERCENT", category: "FEE", value: 2.5, calculation_base: "PRICE" } as any);
    const certificate = await costService.createComponent({ name: "Certificado da pedra", type: "FIXED", category: "OTHER", value: 1.2 } as any);
    await costService.createComponent({ name: "Contabilidade", type: "MONTHLY_FIXED", category: "OPERATIONAL", value: 450, allocation_basis: "PER_ORDER" } as any);
    await costService.createComponent({ name: "Assinatura Nuvemshop", type: "MONTHLY_FIXED", category: "OPERATIONAL", value: 189, allocation_basis: "PER_ORDER" } as any);
    await costService.createComponent({ name: "Anúncios (Meta)", type: "MONTHLY_FIXED", category: "MARKETING", value: 1200, allocation_basis: "PER_PRODUCT" } as any);

    console.log("Creating the catalog…");
    const catalog = buildDemoCatalog();
    const subgroups = new Map<string, string>();
    for (const name of [...new Set(catalog.map((p) => p.subgroup))]) {
      const subgroup = await productSubgroupService.createSubgroup({ name } as any);
      subgroups.set(name, subgroup.id);
      await costService.associateSubgroup({ subgroup_id: subgroup.id, cost_component_id: packaging.id, quantity: 1 } as any);
      await costService.associateSubgroup({ subgroup_id: subgroup.id, cost_component_id: platform.id, quantity: 1 } as any);
      if (name !== "Decoração") {
        await costService.associateSubgroup({ subgroup_id: subgroup.id, cost_component_id: certificate.id, quantity: 1 } as any);
      }
    }
    const productIdsBySubgroup = new Map<string, string[]>();
    for (const p of catalog) {
      const created = await productService.createProduct({
        slug: p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-"),
        name: p.name,
        category: p.category,
        nuvemshop_id: p.nuvemshop_id,
        is_active: true,
        variants: p.variants.map((v) => ({ ...v })),
      } as any);
      productIdsBySubgroup.set(p.subgroup, [...(productIdsBySubgroup.get(p.subgroup) ?? []), created.id]);
    }
    for (const [name, ids] of productIdsBySubgroup) {
      await productSubgroupService.assignProductsToSubgroup(subgroups.get(name)!, ids);
    }

    console.log("Creating ~6 months of orders…");
    const today = new Date();
    const orders = buildDemoOrders(catalog, createRng(2026), today);
    for (const raw of orders) {
      await orderService.upsertOrderFromNuvemshop(mapNuvemshopOrder(raw));
    }

    // A fair this week and a restock, so every screen has something to show.
    const variants = await db("product_variants").select("id", "price").orderBy("sku").limit(6);
    for (const [i, v] of variants.slice(0, 4).entries()) {
      await externalSaleService.createExternalSale({
        customer_name: ["Cliente da feira", "Marina Lopes", "Cliente da feira", "Paula Reis"][i]!,
        items: [{ variant_id: v.id, quantity: 1 + (i % 2), unit_price: Number(v.price) }],
        payment_method: i % 2 === 0 ? "pix" : "credit_card",
        payment_installments: 1,
        is_fair: true,
      });
    }
    for (const v of variants.slice(0, 3)) {
      await inventoryService.addTransaction({ variant_id: v.id, type: "RESTOCK", quantity_changed: 20 });
    }

    console.log("Closing the last three months…");
    for (let back = 3; back >= 1; back--) {
      const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
      await costClosingService.closeMonth({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` });
    }

    const totals = await db("orders").count("* as count").first();
    console.log(`Demo ready: ${catalog.length} products, ${totals?.count ?? 0} orders. Users: ${DEMO_USERS.map((u) => u.email).join(", ")} (password from DEMO_PASSWORD).`);
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error("Demo seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
