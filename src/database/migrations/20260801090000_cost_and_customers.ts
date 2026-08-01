import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("cost_components", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.string("name").notNullable();
    table.string("description").nullable();
    table.string("type").notNullable(); // FIXED | PERCENT | PER_ORDER | MONTHLY
    table.string("category").notNullable().defaultTo("OTHER"); // PACKAGING|TAX|FEE|SHIPPING|OPERATIONAL|MARKETING|OTHER
    table.decimal("value", 10, 2).notNullable().defaultTo(0);
    table.string("calculation_base").notNullable().defaultTo("PRICE"); // PRICE | COST (PERCENT only)
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("product_cost_components", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.uuid("product_id").references("id").inTable("products").onDelete("CASCADE").notNullable().index();
    table.uuid("cost_component_id").references("id").inTable("cost_components").onDelete("CASCADE").notNullable();
    table.integer("quantity").notNullable().defaultTo(1);
    table.timestamps(true, true);
    table.unique(["product_id", "cost_component_id"]);
  });

  await knex.schema.createTable("customers", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid());
    table.string("email").nullable().unique();
    table.string("name").notNullable();
    table.string("city").nullable();
    table.string("province").nullable();
    table.string("phone").nullable();
    table.string("origin").nullable();
    table.string("utm_source").nullable();
    table.string("utm_medium").nullable();
    table.string("utm_campaign").nullable();
    table.string("utm_content").nullable();
    table.string("utm_term").nullable();
    table.timestamp("first_purchase_at").nullable();
    table.timestamp("last_purchase_at").nullable();
    table.timestamp("deleted_at").nullable();
    table.timestamps(true, true);
  });

  await knex.schema.alterTable("orders", (table) => {
    table.string("source", 20).notNullable().defaultTo("NUVEMSHOP");
    table.decimal("total_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("total_profit", 10, 2).notNullable().defaultTo(0);
    table.decimal("margin_percent", 5, 2).notNullable().defaultTo(0);
  });

  await knex.schema.alterTable("order_items", (table) => {
    table.decimal("unit_tax", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_shipping_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_operational_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_marketing_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_other_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_total_cost", 10, 2).notNullable().defaultTo(0);
    table.decimal("unit_profit", 10, 2).notNullable().defaultTo(0);
    table.decimal("margin_percent", 5, 2).notNullable().defaultTo(0);
    table.jsonb("cost_breakdown").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("order_items", (table) => {
    table.dropColumn("unit_tax");
    table.dropColumn("unit_shipping_cost");
    table.dropColumn("unit_operational_cost");
    table.dropColumn("unit_marketing_cost");
    table.dropColumn("unit_other_cost");
    table.dropColumn("unit_total_cost");
    table.dropColumn("unit_profit");
    table.dropColumn("margin_percent");
    table.dropColumn("cost_breakdown");
  });

  await knex.schema.alterTable("orders", (table) => {
    table.dropColumn("source");
    table.dropColumn("total_cost");
    table.dropColumn("total_profit");
    table.dropColumn("margin_percent");
  });

  await knex.schema.dropTableIfExists("customers");
  await knex.schema.dropTableIfExists("product_cost_components");
  await knex.schema.dropTableIfExists("cost_components");
}
