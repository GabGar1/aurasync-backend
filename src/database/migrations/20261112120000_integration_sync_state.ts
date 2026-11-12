import type { Knex } from "knex";

/**
 * Checkpoint of the last successful Nuvemshop sync per resource ("products",
 * "orders"). Incremental syncs ask the API only for records updated after it.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("integration_sync_state", (table) => {
    table.string("resource").primary();
    table.timestamp("last_synced_at", { useTz: true }).notNullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("integration_sync_state");
}
