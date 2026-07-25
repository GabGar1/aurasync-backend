import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { db } from "../lib/db.js";
import {cleanupDatabase} from "../test/setup";

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
        { price: 50, stock_quantity: 100 },
        { price: 150, stock_quantity: 100 }
      ]
    });

    testVariantId1 = product.variants[0]!.id;
    testVariantId2 = product.variants[1]!.id;
  });

  // --- CLEANUP ---
  after(async () => {
    await cleanupDatabase();

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
});