import { describe, it } from "node:test";
import assert from "node:assert";
import { mapNuvemshopOrder, mapNuvemshopOrderStatus, mapNuvemshopProduct } from "./nuvemshop-mapper.js";

describe("mapNuvemshopOrderStatus", () => {
  const cases: Array<[Record<string, string | null>, string]> = [
    [{ status: "open", payment_status: "pending", shipping_status: "unpacked" }, "PENDING"],
    [{ status: "open", payment_status: "authorized", shipping_status: "unpacked" }, "PENDING"],
    [{ status: "open", payment_status: "paid", shipping_status: "unpacked" }, "PAID"],
    [{ status: "open", payment_status: "paid", shipping_status: "shipped" }, "SHIPPED"],
    [{ status: "closed", payment_status: "paid", shipping_status: "delivered" }, "DELIVERED"],
    // "closed" means archived on Nuvemshop: it says nothing about delivery by itself.
    [{ status: "closed", payment_status: "paid", shipping_status: "unpacked" }, "PAID"],
    [{ status: "closed", payment_status: "pending", shipping_status: null }, "PENDING"],
    [{ status: "cancelled", payment_status: "paid", shipping_status: "shipped" }, "CANCELED"],
    [{ status: "open", payment_status: "voided", shipping_status: "unpacked" }, "CANCELED"],
    [{ status: "open", payment_status: "refunded", shipping_status: "unpacked" }, "CANCELED"],
    [{ status: "open", payment_status: "partially_refunded", shipping_status: "unpacked" }, "PAID"],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.strictEqual(mapNuvemshopOrderStatus(input), expected);
    });
  }
});

describe("mapNuvemshopOrder", () => {
  const raw = {
    id: 987,
    status: "open",
    payment_status: "paid",
    shipping_status: "unpacked",
    total: "150.50",
    discount: "10.00",
    contact_name: "Maria Contato",
    contact_email: "maria@example.com",
    customer: { name: "Maria Cliente" },
    products: [
      { variant_id: 111, quantity: 2, price: "70.25", has_promotional_price: true },
      { variant_id: 222, quantity: 1, price: "10.00" },
    ],
    created_at: "2026-11-01T10:00:00+0000",
    gateway: "mercadopago",
  };

  it("maps ids to strings, totals to numbers and products to items", () => {
    const order = mapNuvemshopOrder(raw);
    assert.strictEqual(order.id, "987");
    assert.strictEqual(order.total, 150.5);
    assert.strictEqual(order.status, "PAID");
    assert.strictEqual(order.customer.name, "Maria Cliente");
    assert.strictEqual(order.contact_email, "maria@example.com");
    assert.deepStrictEqual(order.items, [
      { variant_id: "111", quantity: 2, price: 70.25, has_promotional_price: true },
      { variant_id: "222", quantity: 1, price: 10, has_promotional_price: false },
    ]);
  });

  it("keeps the order number the store owner sees on Nuvemshop", () => {
    assert.strictEqual(mapNuvemshopOrder({ ...raw, number: 1043 }).number, "1043");
    assert.strictEqual(mapNuvemshopOrder(raw).number, null);
  });

  it("falls back to the contact name and tolerates a missing product list", () => {
    const order = mapNuvemshopOrder({ ...raw, customer: null, products: undefined });
    assert.strictEqual(order.customer.name, "Maria Contato");
    assert.deepStrictEqual(order.items, []);
  });
});

describe("mapNuvemshopProduct", () => {
  it("maps names, category, publication and variants", () => {
    const product = mapNuvemshopProduct({
      id: 55,
      name: { pt: "Colar de quartzo" },
      categories: [{ name: { pt: "Colares" } }],
      published: true,
      variants: [
        { id: 77, sku: "COL-1", price: "99.90", stock: null, cost: "30", weight: "0.2", has_promotional_price: false },
      ],
    });
    assert.strictEqual(product.id, "55");
    assert.strictEqual(product.name, "Colar de quartzo");
    assert.strictEqual(product.category, "Colares");
    assert.strictEqual(product.is_active, true);
    assert.deepStrictEqual(product.variants[0], {
      id: "77",
      sku: "COL-1",
      price: 99.9,
      stock_quantity: 0,
      cost_price: 30,
      has_promotional_price: false,
      weight: 0.2,
    });
  });

  it("uses safe defaults for a product without name or category", () => {
    const product = mapNuvemshopProduct({ id: 1, name: {}, published: false, variants: [] });
    assert.strictEqual(product.name, "Produto sem nome");
    assert.strictEqual(product.category, "Geral");
    assert.strictEqual(product.is_active, false);
    assert.strictEqual(product.image_url, null);
  });

  it("takes the first image by position as the product photo (https only)", () => {
    const product = mapNuvemshopProduct({
      id: 2, name: { pt: "Anel" }, published: true, variants: [],
      images: [
        { src: "https://acdn.mitiendanube.com/stores/1/products/b.jpg", position: 2 },
        { src: "https://acdn.mitiendanube.com/stores/1/products/a.jpg", position: 1 },
      ],
    });
    assert.strictEqual(product.image_url, "https://acdn.mitiendanube.com/stores/1/products/a.jpg");
    assert.strictEqual(
      mapNuvemshopProduct({ id: 3, name: {}, published: true, variants: [], images: [{ src: "javascript:alert(1)" }] }).image_url,
      null,
    );
  });
});
