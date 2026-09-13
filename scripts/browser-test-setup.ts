import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

loadDotenv();

const configuredBrowserDatabaseUrl = process.env.BROWSER_TEST_DATABASE_URL;
const sourceDatabaseUrl = configuredBrowserDatabaseUrl ?? process.env.DATABASE_URL;
if (!sourceDatabaseUrl) throw new Error("DATABASE_URL is required for browser tests.");

const browserDatabase = new URL(sourceDatabaseUrl);
if (!configuredBrowserDatabaseUrl) {
  browserDatabase.pathname = `${browserDatabase.pathname.replace(/\/$/, "")}_browser`;
}
const databaseName = decodeURIComponent(browserDatabase.pathname.slice(1));

if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
  throw new Error("The browser test database name may only contain letters, numbers, and underscores.");
}

const adminDatabase = new URL(browserDatabase);
adminDatabase.pathname = "/postgres";

const admin = new pg.Client({ connectionString: adminDatabase.toString() });
await admin.connect();
try {
  const existing = await admin.query("select 1 from pg_database where datname = $1", [databaseName]);
  if (existing.rowCount === 0) {
    await admin.query(`create database "${databaseName}"`);
    console.info(`Created browser test database ${databaseName}.`);
  }
} finally {
  await admin.end();
}

const pool = new pg.Pool({ connectionString: browserDatabase.toString(), max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.info("Browser test migrations applied.");
} finally {
  await pool.end();
}
