import { describe, it, after, before } from "node:test";
import assert from "node:assert";
import { inventoryService } from "./inventory.service.js";
import { productService } from "./product.service.js";
import {cleanupDatabase, closeDatabase} from "../test/setup";

describe("InventoryService Integration Tests", () => {
  let testVariantId: string;
  const testProductSlug = "inventory-test-product";
  const initialStock = 10; // Começamos com 10 no estoque

  // --- SETUP ---
  before(async () => {
    // 1. Limpa o banco garantindo terreno fértil
    await cleanupDatabase();

    // 2. Fabricamos um produto base para o teste de estoque
    const product = await productService.createProduct({
      slug: testProductSlug,
      name: "Product for Inventory Tests",
      variants: [
        { price: 100, stock_quantity: initialStock }
      ]
    });

    testVariantId = product.variants[0]!.id;
  });

  // --- CLEANUP ---
  after(async () => {
    await cleanupDatabase();
    await closeDatabase();
  });

  describe("1. Create Transactions (RESTOCK & SALE)", () => {

    it("should successfully add a RESTOCK transaction and increase stock", async () => {
      const transaction = await inventoryService.addTransaction({
        variant_id: testVariantId,
        type: "RESTOCK",
        quantity_changed: 5, // Número positivo
      });

      assert.ok(transaction.id);
      assert.strictEqual(transaction.type, "RESTOCK");
      assert.strictEqual(transaction.quantity_changed, 5);

      const product = await productService.getProductBySlug(testProductSlug);
      const variant = product?.variants.find(v => v.id === testVariantId);

      // 10 (inicial) + 5 (entrada) = 15
      assert.strictEqual(variant?.stock_quantity, 15, "Stock should be updated to 15");
    });

    it("should successfully add a SALE transaction and decrease stock", async () => {
      const transaction = await inventoryService.addTransaction({
        variant_id: testVariantId,
        type: "SALE",
        quantity_changed: -3, // Número negativo conforme a sua migration
      });

      assert.ok(transaction.id);
      assert.strictEqual(transaction.type, "SALE");
      assert.strictEqual(transaction.quantity_changed, -3);

      const product = await productService.getProductBySlug(testProductSlug);
      const variant = product?.variants.find(v => v.id === testVariantId);

      // 15 (atual) - 3 (saída) = 12
      assert.strictEqual(variant?.stock_quantity, 12, "Stock should be updated to 12");
    });

    it("should block a SALE transaction if quantity exceeds current stock", async () => {
      await assert.rejects(
        async () => {
          await inventoryService.addTransaction({
            variant_id: testVariantId,
            type: "SALE",
            quantity_changed: -50, // Tentando tirar mais do que tem
          });
        },
        (err: Error) => {
          assert.match(err.message, /Insufficient stock/i);
          return true;
        }
      );
    });
  });

  describe("2. Get Ledger / History", () => {
    it("should retrieve the transaction history (extrato) for a variant", async () => {
      const history = await inventoryService.getVariantHistory(testVariantId);

      assert.ok(Array.isArray(history));
      assert.strictEqual(history.length, 2, "Should have exactly 2 successful transactions in history");

      assert.strictEqual(history[0]?.type, "SALE");
      assert.strictEqual(history[1]?.type, "RESTOCK");
    });
  });
});