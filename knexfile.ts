import type { Knex } from "knex";
import "dotenv/config";

const TEST_DATABASE_URL = "postgresql://admin:admin@127.0.0.1:5433/aurasync_test";

const config: Knex.Config = {
  client: "pg",
  connection: process.env.NODE_ENV === "test"
    ? (process.env.DATABASE_URL_TEST || TEST_DATABASE_URL)
    : (process.env.DATABASE_URL as string),
  migrations: {
    directory: "./src/database/migrations",
    extension: "ts",
  },
  pool: {
    min: 2,
    max: 10,
    idleTimeoutMillis: 30000
  }
};

export default config;