import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { customerService } from "./customer.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { cleanupDatabase, closeDatabase } from "../test/setup.js";

describe("CustomerService Integration Tests", () => {
  let variantId: string;

  before(async () => {
    await cleanupDatabase();
    const product = await productService.createProduct({
      slug: "customer-test-product",
      name: "Customer Test Product",
      variants: [{ price: 50, stock_quantity: 100, cost_price: 20, nuvemshop_variant_id: "999888777" }],
    });
    variantId = product.variants[0]!.id;
  });

  after(async () => {
    await cleanupDatabase();
    await closeDatabase();
  });

  it("upserts a customer from a Nuvemshop order", async () => {
    await orderService.upsertOrderFromNuvemshop({
      id: "cust-1",
      customer: { name: "Ana Souza" },
      status: "PAID",
      total: 100,
      items: [{ variant_id: "999888777", quantity: 2, price: 50 }],
      contact_email: "ana@test.com",
      shipping_address: { city: "São Paulo", province: "SP" },
      gateway: "nuvem-pago",
      payment_details: { method: "credit_card" },
    } as any);

    const result = await customerService.listCustomers(1, 10, { search: "ana@test.com" });
    assert.strictEqual(result.total, 1);
    const customer = result.customers[0]!;
    assert.strictEqual(customer.name, "Ana Souza");
    assert.strictEqual(customer.city, "São Paulo");
    assert.strictEqual(customer.province, "SP");
    assert.strictEqual(customer.order_count, 1);
    assert.strictEqual(Number(customer.total_spent), 100);
    assert.strictEqual(Number(customer.average_ticket), 100);
  });

  it("returns indicators for a customer", async () => {
    const result = await customerService.listCustomers(1, 10, { search: "ana@test.com" });
    const customer = result.customers[0]!;
    const detail = await customerService.getCustomer(customer.id);
    assert.ok(detail);
    assert.strictEqual(detail.indicators.order_count, 1);
    assert.strictEqual(Number(detail.indicators.total_spent), 100);
    assert.strictEqual(detail.indicators.favorite_payment_method, "credit_card");
    assert.strictEqual(detail.indicators.favorite_gateway, "nuvem-pago");
  });

  it("lists the order history of a customer", async () => {
    const result = await customerService.listCustomers(1, 10, { search: "ana@test.com" });
    const customer = result.customers[0]!;
    const orders = await customerService.getCustomerOrders(customer.id);
    assert.ok(Array.isArray(orders));
    assert.ok(orders!.length >= 1);
  });
});
