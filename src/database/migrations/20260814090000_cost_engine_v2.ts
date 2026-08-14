import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("product_subgroups", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.string("name").notNullable();
    table.string("description").nullable();
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("subgroup_cost_components", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("subgroup_id").references("id").inTable("product_subgroups").onDelete("CASCADE").notNullable().index();
    table.uuid("cost_component_id").references("id").inTable("cost_components").onDelete("CASCADE").notNullable();
    table.integer("quantity").notNullable().defaultTo(1);
    table.timestamps(true, true);
    table.unique(["subgroup_id", "cost_component_id"]);
  });

  await knex.schema.createTable("credit_fee_tiers", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.integer("installments").notNullable().unique();
    table.decimal("percent", 5, 2).notNullable().defaultTo(0);
    table.decimal("fixed_fee", 10, 2).notNullable().defaultTo(0);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("order_monthly_allocations", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("order_id").references("id").inTable("orders").onDelete("CASCADE").notNullable().index();
    table.uuid("cost_component_id").references("id").inTable("cost_components").onDelete("CASCADE").notNullable();
    table.decimal("amount", 10, 2).notNullable().defaultTo(0);
    table.date("period_start").notNullable();
    table.date("period_end").notNullable();
    table.timestamps(true, true);
    table.unique(["order_id", "cost_component_id", "period_start", "period_end"]);
  });

  await knex.schema.alterTable("products", (table) => {
    table.uuid("subgroup_id").references("id").inTable("product_subgroups").onDelete("SET NULL").nullable().index();
  });

  await knex.schema.alterTable("orders", (table) => {
    table.boolean("is_fair").notNullable().defaultTo(false);
    table.decimal("monthly_cost_total", 10, 2).notNullable().defaultTo(0);
  });

  await knex.schema.alterTable("cost_components", (table) => {
    table.integer("max_products_per_package").nullable();
    table.boolean("consolidates").notNullable().defaultTo(false);
    table.string("allocation_basis").nullable();
    table.date("period_start").nullable();
    table.date("period_end").nullable();
    table.boolean("applies_to_fair_only").notNullable().defaultTo(false);
  });

  await knex("credit_fee_tiers").insert([
    { installments: 1, percent: 5.19, fixed_fee: 0.35 },
    { installments: 2, percent: 6.38, fixed_fee: 0 },
    { installments: 3, percent: 7.76, fixed_fee: 0 },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex("credit_fee_tiers").del();
  await knex.schema.alterTable("cost_components", (table) => {
    table.dropColumn("max_products_per_package");
    table.dropColumn("consolidates");
    table.dropColumn("allocation_basis");
    table.dropColumn("period_start");
    table.dropColumn("period_end");
    table.dropColumn("applies_to_fair_only");
  });
  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("is_fair");
    table.dropColumn("monthly_cost_total");
  });
  await knex.schema.alterTable("products", (table) => {
    table.dropColumn("subgroup_id");
  });
  await knex.schema.dropTableIfExists("order_monthly_allocations");
  await knex.schema.dropTableIfExists("credit_fee_tiers");
  await knex.schema.dropTableIfExists("subgroup_cost_components");
  await knex.schema.dropTableIfExists("product_subgroups");
}
