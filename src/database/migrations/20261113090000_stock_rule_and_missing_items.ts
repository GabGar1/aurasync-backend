import type { Knex } from "knex";

/**
 * Stock rule: AuraSync is the source of truth and every order moves stock.
 * - Nuvemshop orders can sell more than AuraSync has, so stock may go negative
 *   (an oversell made visible). Local flows still refuse insufficient stock in code.
 * - "stock_baseline" marks when stock control started: Nuvemshop orders created before
 *   it were already discounted in the stock copied from Nuvemshop and must not move it.
 * - orders.missing_items keeps items whose variant does not exist locally (cost incomplete).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw("ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS stock_non_negative");
  await knex.schema.alterTable("orders", (table) => {
    table.jsonb("missing_items").notNullable().defaultTo("[]");
  });
  await knex("integration_sync_state")
    .insert({ resource: "stock_baseline", last_synced_at: knex.fn.now() })
    .onConflict("resource")
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  await knex("integration_sync_state").where({ resource: "stock_baseline" }).del();
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("missing_items");
  });
  await knex.raw(
    "ALTER TABLE product_variants ADD CONSTRAINT stock_non_negative CHECK (stock_quantity >= 0) NOT VALID"
  );
}
