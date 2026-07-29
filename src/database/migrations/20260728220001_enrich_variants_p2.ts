import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("product_variants", (table) => {
    table.boolean("has_promotional_price").nullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("has_promotional_price");
  });
}
