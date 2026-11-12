import type { Knex } from "knex";

/**
 * token_version is embedded in every JWT (`tv` claim). Incrementing it revokes all
 * sessions of the user: logout, password change/reset.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.integer("token_version").notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("token_version");
  });
}
