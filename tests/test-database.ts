import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

/**
 * The database for PostgreSQL-backed tests: TEST_DATABASE_URL from the shell,
 * else from .env. Undefined means those tests are skipped. Tests create Users,
 * Quotes and Customers they never delete, so the development database is refused.
 */
export function testDatabaseUrl(): string | undefined {
  const localEnv = existsSync(".env") ? parse(readFileSync(".env")) : {};
  const testDatabase = process.env.TEST_DATABASE_URL || localEnv.TEST_DATABASE_URL || undefined;
  const developmentDatabase = process.env.DATABASE_URL ?? localEnv.DATABASE_URL;
  if (testDatabase && developmentDatabase && databaseKey(testDatabase) === databaseKey(developmentDatabase)) {
    throw new Error("TEST_DATABASE_URL points at the DATABASE_URL database. Use a separate test database, for example easy_quote_local_test.");
  }
  return testDatabase;
}

function databaseKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
}
