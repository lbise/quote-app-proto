import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./db/schema";

if (process.env.NODE_ENV !== "production") loadDotenv();

export function connectDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    query_timeout: 2_000,
    statement_timeout: 2_000,
    allowExitOnIdle: true,
  });

  // An idle connection may disappear during a database restart. Avoid an
  // unhandled event without writing connection details into public logs.
  pool.on("error", () => console.error("An idle database connection was lost."));

  return { db: drizzle(pool, { schema }), pool };
}

export type Database = ReturnType<typeof connectDatabase>["db"];

let connection: ReturnType<typeof connectDatabase> | undefined;

export function getDatabase(): Database {
  if (!connection) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required.");
    connection = connectDatabase(connectionString);
  }
  return connection.db;
}
