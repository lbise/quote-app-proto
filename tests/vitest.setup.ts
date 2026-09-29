import { testDatabaseUrl } from "./test-database";

process.env.QUOTE_AI_PROVIDER ??= "google";
process.env.QUOTE_AI_MODEL ??= "gemini-2.5-flash";
process.env.GEMINI_API_KEY ??= "test-only-key";

// Every test file sees the same database, whether TEST_DATABASE_URL came from
// the shell or from .env. The global setup has already migrated it.
const testDatabase = testDatabaseUrl();
if (testDatabase) process.env.TEST_DATABASE_URL = testDatabase;
