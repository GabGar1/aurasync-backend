import { db } from '../lib/db.js';

export const cleanupDatabase = async () => {
  const tables = [
    'order_monthly_allocations',
    'inventory_transactions',
    'order_items',
    'orders',
    'product_variants',
    'products',
    'subgroup_cost_components',
    'product_cost_components',
    'cost_components',
    'credit_fee_tiers',
    'product_subgroups',
    'customers'
  ];

  try {
    for (const table of tables) {
      await db.raw(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
    console.log('Test database cleaned successfully!');
  } catch (error) {
    console.error('Failed to clean test database:', error);
    throw error;
  }
};

export const closeDatabase = async () => {
  await db.destroy();
};