import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE product_variants ADD CONSTRAINT stock_non_negative CHECK (stock_quantity >= 0)'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(
    'ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS stock_non_negative'
  );
}
