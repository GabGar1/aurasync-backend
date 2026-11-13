import type { Knex } from "knex";

/**
 * - products.image_url: first Nuvemshop image (CDN URL), shown as the product thumbnail.
 * - orders.nuvemshop_order_number: the sequential number the store owner sees (#1043),
 *   unlike nuvemshop_order_id, which is the API's internal id.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", (table) => {
    table.text("image_url").nullable();
  });
  await knex.schema.alterTable("orders", (table) => {
    table.string("nuvemshop_order_number").nullable().index();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("nuvemshop_order_number");
  });
  await knex.schema.alterTable("products", (table) => {
    table.dropColumn("image_url");
  });
}
