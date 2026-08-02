import knex from "knex";
import { db } from "../lib/db.js";

const TEST_DATABASE_URL = "postgresql://admin:admin@127.0.0.1:5433/aurasync_test";

function testDatabaseUrl(): string {
  return process.env.DATABASE_URL_TEST || TEST_DATABASE_URL;
}

async function ensureTestDatabaseExists(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.slice(1);
  url.pathname = "/postgres";

  const admin = knex({ client: "pg", connection: url.toString() });
  try {
    const result = await admin.raw("SELECT 1 FROM pg_database WHERE datname = ?", [dbName]);
    if (result.rows.length === 0) {
      await admin.raw(`CREATE DATABASE "${dbName}"`);
      console.log(`Created test database "${dbName}".`);
    }
  } finally {
    await admin.destroy();
  }
}

async function bootstrap(): Promise<void> {
  await ensureTestDatabaseExists();
  await db.migrate.latest();
  console.log("Test database is ready.");
  await db.destroy();
}

bootstrap().catch((error) => {
  console.error("Test database bootstrap failed:", error);
  process.exit(1);
});
