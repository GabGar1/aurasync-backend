import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("product_variants", (table) => {
    table.decimal("weight", 10, 3).nullable();
    table.decimal("height", 10, 2).nullable();
    table.decimal("width", 10, 2).nullable();
    table.decimal("depth", 10, 2).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("product_variants", (table) => {
    table.dropColumn("weight");
    table.dropColumn("height");
    table.dropColumn("width");
    table.dropColumn("depth");
  });
}
