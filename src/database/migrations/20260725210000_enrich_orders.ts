import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.decimal("discount_amount", 10, 2).nullable();
    table.decimal("shipping_cost_customer", 10, 2).nullable();
    table.decimal("shipping_cost_owner", 10, 2).nullable();
    table.timestamp("paid_at").nullable();
    table.timestamp("shipped_at").nullable();
    table.timestamp("completed_at").nullable();
    table.timestamp("cancelled_at").nullable();
    table.string("payment_method", 50).nullable();
    table.integer("payment_installments").nullable();
    table.string("gateway", 100).nullable();
    table.string("shipping_city", 100).nullable();
    table.string("shipping_province", 100).nullable();
    table.string("shipping_carrier", 100).nullable();
    table.string("utm_source", 255).nullable();
    table.string("utm_medium", 50).nullable();
    table.string("utm_campaign", 255).nullable();
    table.string("utm_content", 255).nullable();
    table.string("utm_term", 255).nullable();
    table.string("storefront", 20).nullable();
    table.string("customer_email", 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("discount_amount");
    table.dropColumn("shipping_cost_customer");
    table.dropColumn("shipping_cost_owner");
    table.dropColumn("paid_at");
    table.dropColumn("shipped_at");
    table.dropColumn("completed_at");
    table.dropColumn("cancelled_at");
    table.dropColumn("payment_method");
    table.dropColumn("payment_installments");
    table.dropColumn("gateway");
    table.dropColumn("shipping_city");
    table.dropColumn("shipping_province");
    table.dropColumn("shipping_carrier");
    table.dropColumn("utm_source");
    table.dropColumn("utm_medium");
    table.dropColumn("utm_campaign");
    table.dropColumn("utm_content");
    table.dropColumn("utm_term");
    table.dropColumn("storefront");
    table.dropColumn("customer_email");
  });
}
