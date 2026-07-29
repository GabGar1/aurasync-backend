import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.string("payment_status", 50).nullable();
    table.string("fulfillment_status", 50).nullable();
    table.boolean("has_free_shipping").nullable().defaultTo(false);
  });

  await knex.schema.alterTable("order_items", (table) => {
    table.boolean("has_promotional_price").nullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("payment_status");
    table.dropColumn("fulfillment_status");
    table.dropColumn("has_free_shipping");
  });

  await knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("has_promotional_price");
  });
}
