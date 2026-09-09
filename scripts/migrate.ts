import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (process.env.NODE_ENV !== "production") loadDotenv();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    // Bound lock waits and migration runtime; failures must block startup.
    options: "-c lock_timeout=10000 -c statement_timeout=60000",
  });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.info("Database migrations applied.");
  } catch {
    console.error("Database migration failed. Check connectivity, permissions and migration compatibility.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
