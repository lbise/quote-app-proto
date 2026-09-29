import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

process.env.QUOTE_AI_PROVIDER ??= "google";
process.env.QUOTE_AI_MODEL ??= "gemini-2.5-flash";
process.env.GEMINI_API_KEY ??= "test-only-key";

// Database-backed tests use TEST_DATABASE_URL. Take it from .env when the shell
// does not set it, so every local run (human or agent) uses the same database.
const localEnv = existsSync(".env") ? parse(readFileSync(".env")) : {};
process.env.TEST_DATABASE_URL ??= localEnv.TEST_DATABASE_URL || undefined;

// Tests create Users, Quotes and Customers they never delete. Refuse to run
// them against the development database.
const databaseKey = (url: string) => {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
};
const testDatabase = process.env.TEST_DATABASE_URL;
const developmentDatabase = process.env.DATABASE_URL ?? localEnv.DATABASE_URL;
if (testDatabase && developmentDatabase && databaseKey(testDatabase) === databaseKey(developmentDatabase)) {
  throw new Error("TEST_DATABASE_URL points at the DATABASE_URL database. Use a separate test database, for example easy_quote_local_test.");
}
