import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { Client } from "pg";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { costService } from "./cost.service.js";
import { db } from "../lib/db.js";
import {cleanupDatabase, closeDatabase} from "../test/setup";

describe("OrderService Integration Tests", () => {
  const testCustomerNames = [
    "Integration Test Customer",
    "Temp Delete Customer"
  ];

  let mainOrderId: string;
  let testVariantId1: string;
  let testVariantId2: string;
  const testProductSlug = "temp-order-test-product";

  // --- SETUP ---
  before(async () => {
    await cleanupDatabase();

    const product = await productService.createProduct({
      slug: "temp-order-test-product",
      name: "Product for Order Tests",
      variants: [
        { name: "Order Test Variant 1", price: 50, stock_quantity: 100 },
        { name: "Order Test Variant 2", price: 150, stock_quantity: 100 }
      ]
    });

    testVariantId1 = product.variants[0]!.id;
    testVariantId2 = product.variants[1]!.id;
  });

  // --- CLEANUP ---
  after(async () => {
    await cleanupDatabase();
    await closeDatabase();
  });

  // --- CREATE ---
  describe("1. Create Order", () => {
    it("should create an order and automatically calculate the exact total_amount", async () => {
      const orderData = {
        customer_name: testCustomerNames[0]!,
        status: "PENDING",
        items: [
          {
            variant_id: testVariantId1,
            quantity: 2,
            unit_price: 50.00,   // Total esperado: 100
          },
          {
            variant_id: testVariantId2,
            quantity: 1,
            unit_price: 150.00,  // Total esperado: 150
          }
        ]
      };

      const order = await orderService.createOrder(orderData as any);
      mainOrderId = order.id;

      assert.ok(order.id);
      assert.strictEqual(order.customer_name, testCustomerNames[0]);

      // O Grande Teste Financeiro: (2 * 50) + (1 * 150) = 250
      assert.strictEqual(Number(order.total_amount), 250, "Total amount must be exactly calculated by the service");

      assert.strictEqual(order.items.length, 2);
    });

    it("should fail to create an order without items", async () => {
      const invalidOrder = {
        customer_name: "Ghost Customer",
        items: [] // O Zod deve barrar isso
      };

      await assert.rejects(
        async () => await orderService.createOrder(invalidOrder as any),
        (err: Error) => {
          assert.match(err.message, /Order must have at least one item/i);
          return true;
        }
      );
    });
  });

  // --- GET / READ ---
  describe("2. Get Orders", () => {
    it("should retrieve an existing order by ID including its items", async () => {
      const order = await orderService.getOrderById(mainOrderId);

      assert.ok(order);
      assert.strictEqual(order.id, mainOrderId);
      assert.strictEqual(order.items.length, 2);
      assert.strictEqual(order.items[0]!.status, true, "Items must be active");
    });

    it("returns product_name and variant_name on order items", async () => {
      const order = await orderService.getOrderById(mainOrderId);

      assert.ok(order);
      assert.strictEqual(order.items[0]!.product_name, "Product for Order Tests");
      assert.ok(order.items[0]!.variant_name != null);
    });

    it("should list orders with pagination", async () => {
      const result = await orderService.getOrders(1, 10);

      assert.ok(result.orders);
      assert.ok(Array.isArray(result.orders));
      assert.ok(result.total >= 1);
    });
  });

  // --- UPDATE ---
  describe("3. Update Order", () => {
    it("should update order status and customer name successfully", async () => {
      const updateData = {
        customer_name: "Updated Customer Name",
        status: "PAID" as const
      };

      const updatedOrder = await orderService.updateOrder(mainOrderId, updateData);

      assert.ok(updatedOrder);
      assert.strictEqual(updatedOrder.customer_name, "Updated Customer Name");
      assert.strictEqual(updatedOrder.status, "PAID");
      assert.strictEqual(updatedOrder.id, mainOrderId);
    });
  });

  // --- DELETE (CANCELAMENTO) ---
  describe("4. Delete (Cancel) Order", () => {
    it("should soft delete an order and inactivate its items", async () => {
      // 1. Cria pedido descartável
      const tempOrder = await orderService.createOrder({
        customer_name: testCustomerNames[1]!,
        items: [{ variant_id: testVariantId1, quantity: 1, unit_price: 50 }]
      });

      // 2. Deleta/Cancela o pedido
      const deleteResult = await orderService.deleteOrder(tempOrder.id);
      assert.strictEqual(deleteResult, true);

      // 3. Verifica se sumiu (porque o soft delete esconde o registro na busca padrão)
      const checkOrder = await orderService.getOrderById(tempOrder.id);
      assert.strictEqual(checkOrder, null);
    });
  });

  // --- STOCK DEDUCTION ---
  describe("5. Stock Deduction on Order Creation", () => {
    let stockTestVariantId: string;

    before(async () => {
      const product = await productService.createProduct({
        slug: "stock-deduction-test",
        name: "Stock Deduction Test",
        variants: [{ price: 100, stock_quantity: 20 }],
      });
      stockTestVariantId = product.variants[0]!.id;
    });

    it("should deduct stock when order is created", async () => {
      const order = await orderService.createOrder({
        customer_name: "Stock Test",
        items: [{ variant_id: stockTestVariantId, quantity: 5, unit_price: 100 }],
      });

      assert.ok(order);

      const variant = await db("product_variants")
        .where({ id: stockTestVariantId })
        .first();
      assert.strictEqual(variant.stock_quantity, 15);

      const tx = await db("inventory_transactions")
        .where({ variant_id: stockTestVariantId, order_id: order.id })
        .first();
      assert.ok(tx);
      assert.strictEqual(tx.quantity_changed, -5);
      assert.strictEqual(tx.type, "SALE");
    });

    it("should throw error when insufficient stock", async () => {
      await assert.rejects(
        async () => {
          await orderService.createOrder({
            customer_name: "Over Order",
            items: [{ variant_id: stockTestVariantId, quantity: 100, unit_price: 100 }],
          });
        },
        (err: Error) => {
          assert.ok(err.message.includes("Insufficient stock"));
          return true;
        }
      );

      const variant = await db("product_variants")
        .where({ id: stockTestVariantId })
        .first();
      assert.strictEqual(variant.stock_quantity, 15);
    });

    it("should prevent double-deduction under concurrent requests", async () => {
      const product = await productService.createProduct({
        slug: "concurrent-stock-test",
        name: "Concurrent Stock Test",
        variants: [{ price: 50, stock_quantity: 10 }],
      });
      const concVariantId = product.variants[0]!.id;

      const results = await Promise.allSettled([
        orderService.createOrder({
          customer_name: "Concurrent A",
          items: [{ variant_id: concVariantId, quantity: 5, unit_price: 50 }],
        }),
        orderService.createOrder({
          customer_name: "Concurrent B",
          items: [{ variant_id: concVariantId, quantity: 5, unit_price: 50 }],
        }),
      ]);

      const fulfilled = results.filter(r => r.status === "fulfilled").length;
      assert.strictEqual(fulfilled, 2, "Both orders should succeed");

      const variant = await db("product_variants")
        .where({ id: concVariantId })
        .first();
      assert.strictEqual(variant.stock_quantity, 0);

      await db("inventory_transactions").where({ variant_id: concVariantId }).del();
      await db("order_items")
        .whereIn("order_id", results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<any>).value.id))
        .del();
      await db("orders")
        .whereIn("id", results.filter(r => r.status === "fulfilled").map(r => (r as PromiseFulfilledResult<any>).value.id))
        .del();
      await db("product_variants").where({ id: concVariantId }).del();
      await db("products").where({ slug: "concurrent-stock-test" }).del();
    });
  });

  describe("6. Nuvemshop Order Upsert Enrichment", () => {
    it("should store all enriched fields from a full Nuvemshop order payload", async () => {
      const product = await productService.createProduct({
        slug: "enrich-upsert-test",
        name: "Enriched Upsert Product",
        variants: [
          {
            sku: "ENRICH-001",
            price: 49.90,
            stock_quantity: 100,
            nuvemshop_variant_id: "999888777",
          },
        ],
      });
      const nuvemshopVariantId = product.variants[0]!.nuvemshop_variant_id!;

      const nuvemshopOrderData = {
        id: "1969442650",
        customer: { name: "Aline Costa Fernandes" },
        status: "PAID",
        total: 125.66,
        items: [
          { variant_id: nuvemshopVariantId, quantity: 2, price: 49.90, has_promotional_price: true },
        ],
        discount: "49.40",
        shipping_cost_customer: "25.36",
        shipping_cost_owner: "25.36",
        payment_status: "paid",
        fulfillments: [{ status: "shipped" }],
        free_shipping_config: { cart_has_free_shipping: true },
        created_at: "2026-05-12T14:30:00+0000",
        paid_at: "2026-05-13T17:49:03+0000",
        shipped_at: null,
        completed_at: {
          date: "2026-05-13 17:49:00.000000",
          timezone_type: 3,
          timezone: "UTC",
        },
        cancelled_at: null,
        payment_details: {
          method: "credit_card",
          credit_card_company: "elo",
          installments: 3,
        },
        gateway: "nuvem-pago",
        shipping_address: {
          city: "Belo Horizonte",
          province: "Minas Gerais",
        },
        shipping_carrier_name: "Nuvem Envio",
        customer_visit: {
          utm_parameters: {
            utm_source: "ig",
            utm_medium: "paid",
            utm_campaign: "120222198954390582",
            utm_content: "120240092594690582",
            utm_term: "120240092594710582",
          },
        },
        storefront: "mobile",
        contact_email: "ninicksacf@gmail.com",
      };

      const order = await orderService.upsertOrderFromNuvemshop(
        nuvemshopOrderData as any
      );

      assert.ok(order);
      assert.strictEqual(order.nuvemshop_order_id, "1969442650");
      assert.strictEqual(order.customer_name, "Aline Costa Fernandes");
      assert.strictEqual(order.status, "PAID");
      assert.strictEqual(Number(order.total_amount), 125.66);

      assert.strictEqual(Number(order.discount_amount), 49.40);
      assert.strictEqual(Number(order.shipping_cost_customer), 25.36);
      assert.strictEqual(Number(order.shipping_cost_owner), 25.36);
      assert.ok(order.created_at instanceof Date);
      assert.strictEqual(order.created_at.toISOString().slice(0, 10), "2026-05-12");
      assert.ok(order.paid_at instanceof Date);
      assert.strictEqual(order.shipped_at, null);
      assert.ok(order.completed_at instanceof Date);
      assert.strictEqual(order.cancelled_at, null);
      assert.strictEqual(order.payment_method, "credit_card");
      assert.strictEqual(order.payment_installments, 3);
      assert.strictEqual(order.gateway, "nuvem-pago");
      assert.strictEqual(order.shipping_city, "Belo Horizonte");
      assert.strictEqual(order.shipping_province, "Minas Gerais");
      assert.strictEqual(order.shipping_carrier, "Nuvem Envio");
      assert.strictEqual(order.utm_source, "ig");
      assert.strictEqual(order.utm_medium, "paid");
      assert.strictEqual(order.utm_campaign, "120222198954390582");
      assert.strictEqual(order.utm_content, "120240092594690582");
      assert.strictEqual(order.utm_term, "120240092594710582");
      assert.strictEqual(order.storefront, "mobile");
      assert.strictEqual(order.customer_email, "ninicksacf@gmail.com");
      assert.strictEqual(order.payment_status, "paid");
      assert.strictEqual(order.fulfillment_status, "shipped");
      assert.strictEqual(order.has_free_shipping, true);
      assert.strictEqual(order.items[0]!.has_promotional_price, true);

      // Cleanup order
      await db("orders").where({ id: order.id }).del();
      await db("product_variants")
        .where({ product_id: product.id })
        .del();
      await db("products").where({ id: product.id }).del();
    });

    it("should handle a minimal Nuvemshop order payload without enriched fields", async () => {
      const product = await productService.createProduct({
        slug: "minimal-upsert-test",
        name: "Minimal Upsert Product",
        variants: [
          {
            sku: "MIN-001",
            price: 30.00,
            stock_quantity: 50,
            nuvemshop_variant_id: "111222333",
          },
        ],
      });
      const nuvemshopVariantId = product.variants[0]!.nuvemshop_variant_id!;

      const minimalData = {
        id: "1234567890",
        customer: { name: "Minimal Customer" },
        status: "PENDING",
        total: 60.0,
        items: [
          { variant_id: nuvemshopVariantId, quantity: 2, price: 30.00 },
        ],
      };

      const order = await orderService.upsertOrderFromNuvemshop(
        minimalData as any
      );

      assert.ok(order);
      assert.strictEqual(order.nuvemshop_order_id, "1234567890");
      assert.strictEqual(Number(order.total_amount), 60.0);
      assert.strictEqual(order.discount_amount, null);
      assert.strictEqual(order.payment_method, null);
      assert.strictEqual(order.utm_source, null);
      assert.strictEqual(order.customer_email, null);
      assert.strictEqual(order.payment_status, null);
      assert.strictEqual(order.fulfillment_status, null);
      assert.strictEqual(order.has_free_shipping, null);
      assert.strictEqual(order.items[0]!.has_promotional_price, null);

      // Cleanup
      await db("orders").where({ id: order.id }).del();
      await db("product_variants")
        .where({ product_id: product.id })
        .del();
      await db("products").where({ id: product.id }).del();
    });

    it("keeps created_at frozen when the same order is re-synced", async () => {
      const product = await productService.createProduct({
        slug: "immutable-date-test",
        name: "Immutable Date Product",
        variants: [
          {
            sku: "IMMUT-001",
            price: 30.00,
            stock_quantity: 50,
            nuvemshop_variant_id: "444555666",
          },
        ],
      });
      const nuvemshopVariantId = product.variants[0]!.nuvemshop_variant_id!;

      const base = {
        id: "immutable-date-1",
        customer: { name: "Immutable Customer" },
        status: "PAID",
        total: 60.0,
        items: [{ variant_id: nuvemshopVariantId, quantity: 2, price: 30.00 }],
        contact_email: "immutable@test.com",
      };

      const first = await orderService.upsertOrderFromNuvemshop({
        ...base,
        created_at: "2026-05-01T10:00:00+0000",
      } as any);
      assert.ok(first.created_at instanceof Date);
      assert.strictEqual(first.created_at.toISOString().slice(0, 10), "2026-05-01");

      const second = await orderService.upsertOrderFromNuvemshop({
        ...base,
        created_at: "2026-05-20T10:00:00+0000",
      } as any);
      assert.ok(second.created_at instanceof Date);
      assert.strictEqual(
        second.created_at.toISOString().slice(0, 10),
        "2026-05-01",
        "created_at must not change on re-sync"
      );

      // Cleanup
      await db("orders").where({ id: first.id }).del();
      await db("product_variants")
        .where({ product_id: product.id })
        .del();
      await db("products").where({ id: product.id }).del();
    });
  });

  describe("7. Cost Snapshot on Order Creation", () => {
    let snapVariantId: string;

    before(async () => {
      const product = await productService.createProduct({
        slug: "snapshot-cost-test",
        name: "Snapshot Cost Test",
        variants: [{ price: 100, stock_quantity: 50, cost_price: 40, packaging_cost: 2, platform_fee_percent: 3 }],
      });
      snapVariantId = product.variants[0]!.id;

      const component = await costService.createComponent({
        name: "Caixa Snapshot", type: "FIXED", value: 1.5, category: "PACKAGING",
      });
      await costService.associateComponent({
        product_id: product.id, cost_component_id: component.id, quantity: 2,
      });
    });

    it("persists the full cost snapshot on the order item", async () => {
      const order = await orderService.createOrder({
        customer_name: "Snapshot Customer",
        items: [{ variant_id: snapVariantId, quantity: 1, unit_price: 100 }],
      });

      const item = order.items[0]!;
      assert.strictEqual(Number(item.unit_cost), 40);
      assert.strictEqual(Number(item.unit_packaging_cost), 3); // 1.5 * 2
      assert.strictEqual(Number(item.unit_platform_fee), 0);   // components supersede legacy
      assert.strictEqual(Number(item.unit_total_cost), 43);
      assert.strictEqual(Number(item.unit_profit), 57);
      assert.strictEqual(Number(item.margin_percent), 57);
      assert.ok(Array.isArray(item.cost_breakdown));
      assert.ok((item.cost_breakdown as any[]).length >= 2);
      assert.strictEqual(Number(order.total_cost), 43);
      assert.strictEqual(Number(order.total_profit), 57);

      const row = await db("orders").where({ id: order.id }).first();
      assert.strictEqual(Number(row.total_cost), 43);
      assert.strictEqual(Number(row.total_profit), 57);
    });
  });

  describe("8. Order Enrichment", () => {
    it("returns translated status and financial indicators", async () => {
      const order = await orderService.createOrder({
        customer_name: "Enrichment Customer",
        items: [{ variant_id: testVariantId1, quantity: 1, unit_price: 50 }],
      });
      assert.strictEqual(order.status_label, "Pendente");
      assert.strictEqual(order.commercial_status, "Em aberto");
      assert.strictEqual(typeof order.total_cost, "number");
      assert.strictEqual(typeof order.margin_percent, "number");
      assert.ok(order.items[0]!.unit_total_cost >= 0);
    });
  });

  describe("9. Orphaned Order Items (legacy unmapped variants)", () => {
    it("keeps order items whose variant no longer exists in fetch and list queries", async () => {
      const order = await orderService.createOrder({
        customer_name: "Orphan Items Customer",
        items: [{ variant_id: testVariantId1, quantity: 1, unit_price: 50 }],
      });

      const orphanVariantId = "00000000-0000-0000-0000-0000000000ff";
      // Legacy imports can leave order_items pointing at variants that were
      // never mapped. The FK constraint rejects such rows, so bypass it on a
      // dedicated connection with a session-scoped replica role (no persistent
      // schema changes).
      const client = new Client({
        connectionString:
          process.env.DATABASE_URL_TEST ||
          "postgresql://admin:admin@127.0.0.1:5433/aurasync_test",
      });
      await client.connect();
      try {
        await client.query("SET session_replication_role = replica");
        await client.query(
          `INSERT INTO order_items (order_id, variant_id, quantity, unit_price, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [order.id, orphanVariantId, 1, 10, true]
        );
        await client.query("RESET session_replication_role");
      } finally {
        await client.end();
      }

      const fetched = await orderService.getOrderById(order.id);
      assert.ok(fetched);
      const orphanItem = fetched.items.find((i) => i.variant_id === orphanVariantId);
      assert.ok(orphanItem, "orphaned item must survive the fetch items query");
      assert.strictEqual(orphanItem.product_name, "Produto removido");
      assert.strictEqual(orphanItem.variant_name, null);

      const listed = await orderService.getOrders(1, 10);
      const listedOrder = listed.orders.find((o) => o.id === order.id);
      assert.ok(listedOrder);
      const listedOrphan = listedOrder.items.find((i) => i.variant_id === orphanVariantId);
      assert.ok(listedOrphan, "orphaned item must survive the list items query");
      assert.strictEqual(listedOrphan.product_name, "Produto removido");
    });
  });

  describe("10. Monthly Allocations Cost Component Name", () => {
    it("returns component name on monthly allocations", async () => {
      const [component] = await db("cost_components")
        .insert({ name: "Equipe", type: "MONTHLY_FIXED", category: "OPERATIONAL", value: 500 })
        .returning("*");
      await db("order_monthly_allocations").insert({
        order_id: mainOrderId,
        cost_component_id: component.id,
        amount: 25.0,
        period_start: "2026-08-01",
        period_end: "2026-08-31",
      });
      const order = await orderService.getOrderById(mainOrderId);
      assert.ok(order);
      const alloc = order.monthly_allocations.find((a: any) => a.cost_component_id === component.id);
      assert.ok(alloc);
      assert.strictEqual(alloc.cost_component_name, "Equipe");
    });
  });
});