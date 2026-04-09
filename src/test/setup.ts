import { db } from '../lib/db.js';

export const cleanupDatabase = async () => {
  const tables = [
    'inventory_transactions',
    'order_items',
    'orders',
    'product_variants',
    'products',
    'users'
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