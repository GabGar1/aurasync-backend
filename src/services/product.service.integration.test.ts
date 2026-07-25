import {describe, it, after, before} from "node:test";
import assert from "node:assert";
import { productService } from "./product.service.js";
import { db } from "../lib/db.js";
import {cleanupDatabase} from "../test/setup";

describe("ProductService Integration Tests", () => {
  // Lista de slugs que vamos usar e depois limpar do banco
  const testSlugs = [
    "premium-gaming-mouse-test",
    "duplicate-slug-test",
    "update-target-slug-test",
    "delete-target-slug-test"
  ];

  let mainProductId: string;

  before(async () => {
    await cleanupDatabase();
  });

  after(async () => {
    await cleanupDatabase();
  });

  // Limpa o banco após rodar todos os testes (Hard Delete real para limpar sujeira de teste)
  after(async () => {
    // Como a sua migration tem onDelete('CASCADE') no product_id das variações,
    // deletar o produto pai aqui já vai varrer as variações filhas automaticamente!
    await db("products").whereIn("slug", testSlugs).del();
    await db.destroy();
  });

  // --- CREATE ---
  describe("1. Create Product", () => {
    it("should successfully create a new product with variants", async () => {
      const productData = {
        slug: testSlugs[0]!,
        name: "Premium Gaming Mouse",
        category: "Peripherals",
        is_active: true,
        variants: [
          {
            sku: "MOU-GM-BLK",
            name: "Matte Black",
            price: 299.90,
            stock_quantity: 50,
            cost_price: 150.00
          },
          {
            sku: "MOU-GM-WHT",
            name: "Glacier White",
            price: 319.90,
            stock_quantity: 20,
            cost_price: 160.00
          }
        ]
      };

      const product = await productService.createProduct(productData);
      mainProductId = product.id; // Salva o ID para usar nos próximos testes

      assert.ok(product.id, "Product must have an ID");
      assert.strictEqual(product.name, "Premium Gaming Mouse");
      assert.strictEqual(product.slug, testSlugs[0]);

      // Valida se as variações foram salvas e retornadas junto
      assert.ok(product.variants);
      assert.strictEqual(product.variants.length, 2, "Must return exactly 2 variants");
      assert.strictEqual(product.variants[0]?.sku, "MOU-GM-BLK");
      assert.strictEqual(Number(product.variants[0]?.price), 299.90);
    });

    it("should prevent creation with a duplicate slug", async () => {
      const duplicateData = {
        slug: testSlugs[0]!, // Tentando usar o slug do teste anterior
        name: "Another Mouse",
        variants: [
          { price: 100, stock_quantity: 10 }
        ]
      };

      await assert.rejects(
        async () => await productService.createProduct(duplicateData),
        (err: Error) => {
          assert.strictEqual(err.message, "A product with this slug already exists");
          return true;
        }
      );
    });
  });

  // --- GET / READ ---
  describe("2. Get Products", () => {
    it("should retrieve an existing product by ID with its variants", async () => {
      const product = await productService.getProductById(mainProductId);

      assert.ok(product);
      assert.strictEqual(product.id, mainProductId);
      assert.strictEqual(product.variants.length, 2);
    });

    it("should retrieve an existing product by Slug", async () => {
      const product = await productService.getProductBySlug(testSlugs[0]!);

      assert.ok(product);
      assert.strictEqual(product.slug, testSlugs[0]);
    });

    it("should return null for a non-existent product ID", async () => {
      const fakeId = "123e4567-e89b-12d3-a456-426614174000";
      const product = await productService.getProductById(fakeId);
      assert.strictEqual(product, null);
    });

    it("should list products with pagination", async () => {
      const result = await productService.getProducts(1, 10);

      assert.ok(result.products);
      assert.ok(Array.isArray(result.products));
      assert.ok(result.total >= 1);
    });
  });

  // --- UPDATE ---
  describe("3. Update Product", () => {
    it("should update product basic info successfully", async () => {
      const updateData = {
        name: "Premium Gaming Mouse - Pro Edition",
        slug: testSlugs[2]! // Trocando o slug para testar
      };

      const updatedProduct = await productService.updateProduct(mainProductId, updateData);

      assert.ok(updatedProduct);
      assert.strictEqual(updatedProduct.name, "Premium Gaming Mouse - Pro Edition");
      assert.strictEqual(updatedProduct.slug, testSlugs[2]);
      assert.strictEqual(updatedProduct.id, mainProductId);
    });

    it("should prevent updating to a slug that already belongs to another product", async () => {
      // Cria um produto temporário para "roubar" um slug
      await productService.createProduct({
        slug: "blocked-slug-test",
        name: "Blocker Product",
        variants: [{ price: 10, stock_quantity: 1 }]
      });
      // Adiciona na lista de limpeza
      testSlugs.push("blocked-slug-test");

      // Tenta atualizar o nosso produto principal para o slug bloqueado
      await assert.rejects(
        async () => await productService.updateProduct(mainProductId, { slug: "blocked-slug-test" }),
        (err: Error) => {
          assert.strictEqual(err.message, "A product with this new slug already exists");
          return true;
        }
      );
    });
  });

  // --- DELETE ---
  describe("4. Delete Product", () => {
    it("should successfully soft delete a product and its variants", async () => {
      // 1. Cria um produto descartável
      const tempProduct = await productService.createProduct({
        slug: testSlugs[3]!,
        name: "To Be Deleted",
        variants: [{ price: 50, stock_quantity: 5 }]
      });

      // 2. Deleta o produto
      const deleteResult = await productService.deleteProduct(tempProduct.id);
      assert.strictEqual(deleteResult, true);

      // 3. Verifica se ele sumiu das buscas normais (que ignoram deleted_at)
      const checkProduct = await productService.getProductById(tempProduct.id);
      assert.strictEqual(checkProduct, null);
    });
  });

  describe("Nuvemshop Product Upsert Enrichment", () => {
    it("should store variant dimensions from Nuvemshop payload", async () => {
      const nuvemshopData = {
        id: "159029942",
        name: "Anel Biterminado",
        category: "Anéis",
        is_active: true,
        variants: [
          {
            id: "601866046",
            sku: "ABCS",
            price: 46.00,
            stock_quantity: 10,
            cost_price: 18.50,
            weight: 0.250,
            height: 9.00,
            width: 15.00,
            depth: 23.00,
          },
        ],
      };

      const product =
        await productService.upsertProductFromNuvemshop(nuvemshopData as any);

      assert.ok(product);
      assert.strictEqual(product.name, "Anel Biterminado");
      assert.strictEqual(product.variants.length, 1);

      const variant = product.variants[0]!;
      assert.strictEqual(Number(variant.weight), 0.250);
      assert.strictEqual(Number(variant.height), 9.00);
      assert.strictEqual(Number(variant.width), 15.00);
      assert.strictEqual(Number(variant.depth), 23.00);

      // Cleanup
      await db("product_variants")
        .where({ product_id: product.id })
        .del();
      await db("products").where({ id: product.id }).del();
    });

    it("should handle variants without dimensions (null)", async () => {
      const nuvemshopData = {
        id: "123456789",
        name: "No Dimensions Product",
        is_active: true,
        variants: [
          {
            id: "987654321",
            sku: "NODIM-001",
            price: 30.00,
            stock_quantity: 5,
          },
        ],
      };

      const product =
        await productService.upsertProductFromNuvemshop(nuvemshopData as any);

      const variant = product.variants[0]!;
      assert.strictEqual(variant.weight, null);
      assert.strictEqual(variant.height, null);
      assert.strictEqual(variant.width, null);
      assert.strictEqual(variant.depth, null);

      // Cleanup
      await db("product_variants")
        .where({ product_id: product.id })
        .del();
      await db("products").where({ id: product.id }).del();
    });
  });
});