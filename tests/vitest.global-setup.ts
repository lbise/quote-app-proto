import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { testDatabaseUrl } from "./test-database";

/**
 * Apply every committed migration to the test database once, before any test
 * runs, so database-backed tests never meet an out-of-date schema. Already
 * applied migrations are skipped.
 */
export default async function migrateTestDatabase() {
  const connectionString = testDatabaseUrl();
  if (!connectionString) return;
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    options: "-c lock_timeout=10000 -c statement_timeout=60000",
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } catch (error) {
    throw new Error(`Could not migrate the test database (TEST_DATABASE_URL). Is PostgreSQL running? ${error instanceof Error ? error.message : ""}`);
  } finally {
    await pool.end();
  }
}
