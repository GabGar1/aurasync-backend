import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // 1. Usuários (RBAC)
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.string('email').notNullable().unique();
    table.string('password_hash').notNullable();
    table.string('role').notNullable().defaultTo('EMPLOYEE');
    table.timestamp('deleted_at').nullable();
    table.timestamps(true, true);
    table.boolean('status').notNullable().defaultTo(true);
  });

  // 2. Produtos
  await knex.schema.createTable('products', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('nuvemshop_id').unique().nullable().index();
    table.string('slug').notNullable();
    table.string('name').notNullable();
    table.string('category').nullable();
    table.boolean('is_active').defaultTo(true);
    table.timestamp('deleted_at').nullable();
    table.timestamps(true, true);
  });

  // 3. Variações do Produto (Estoque e Custos)
  await knex.schema.createTable('product_variants', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('product_id').references('id').inTable('products').onDelete('CASCADE').index();
    table.string('nuvemshop_variant_id').unique().nullable();
    table.string('sku').nullable();
    table.string('name').nullable();

    // Venda e Estoque
    table.decimal('price', 10, 2).notNullable().defaultTo(0);
    table.integer('stock_quantity').notNullable().defaultTo(0);

    // Custos base (A fonte da verdade para o cadastro atual)
    table.decimal('cost_price', 10, 2).defaultTo(0);
    table.decimal('packaging_cost', 10, 2).defaultTo(0);
    table.decimal('platform_fee_percent', 5, 2).defaultTo(0);
    table.decimal('fixed_fee', 10, 2).defaultTo(0);

    table.timestamp('deleted_at').nullable();
    table.timestamps(true, true);
  });

  // 4. Pedidos (Ordens de Venda)
  await knex.schema.createTable('orders', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('nuvemshop_order_id').unique().nullable();
    table.string('customer_name').nullable();
    table.string('status').notNullable().defaultTo('PENDING'); // PENDING, PAID, SHIPPED...
    table.decimal('total_amount', 10, 2).notNullable().defaultTo(0);
    table.timestamp('deleted_at').nullable();
    table.timestamps(true, true);
  });

  // 5. Itens do Pedido (O Snapshot Financeiro)
  await knex.schema.createTable('order_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('order_id').references('id').inTable('orders').onDelete('CASCADE');
    table.uuid('variant_id').references('id').inTable('product_variants').onDelete('RESTRICT');

    table.integer('quantity').notNullable();

    // Fotografia financeira no momento exato da venda!
    table.decimal('unit_price', 10, 2).notNullable();
    table.decimal('unit_cost', 10, 2).notNullable().defaultTo(0); // O cost_price da época
    table.decimal('unit_packaging_cost', 10, 2).notNullable().defaultTo(0);
    table.decimal('unit_platform_fee', 10, 2).notNullable().defaultTo(0);

    table.timestamps(true, true);
    table.boolean('status').notNullable().defaultTo(true);
  });

  // 6. Transações de Estoque (Ledger para a IA analisar)
  await knex.schema.createTable('inventory_transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('variant_id').references('id').inTable('product_variants').onDelete('CASCADE');
    table.uuid('order_id').references('id').inTable('orders').nullable().onDelete('SET NULL');

    table.integer('quantity_changed').notNullable(); // Negativo para saída, positivo para entrada
    table.string('type').notNullable(); // SALE, RESTOCK, ADJUSTMENT

    table.timestamps(true, true); // O created_at define exatamente QUANDO o evento ocorreu
    table.boolean('status').notNullable().defaultTo(true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inventory_transactions');
  await knex.schema.dropTableIfExists('order_items');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('product_variants');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('users');
}