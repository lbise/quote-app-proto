import { randomUUID } from "node:crypto";

import pg from "pg";

import type { Database } from "../app/lib/db.server";

const evaluationDatabase = "quote_evaluation";
const evaluationUser = "quote_evaluation";

type EvaluationConnection = {
  databaseUrl: string;
  database: Database;
  close(): Promise<void>;
};

type EnvironmentSnapshot = Map<string, string | undefined>;

/**
 * The control URL must point at the database created by scripts/eval-db.sh.
 * It is deliberately not DATABASE_URL or TEST_DATABASE_URL: evaluation never
 * falls back to an application connection string.
 */
export function assertEvaluationControlUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EVAL_DATABASE_URL must be a PostgreSQL URL for the dedicated evaluation database.");
  }
  if ((url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    || decodeURIComponent(url.pathname.slice(1)) !== evaluationDatabase
    || decodeURIComponent(url.username) !== evaluationUser) {
    throw new Error("EVAL_DATABASE_URL must use the local quote_evaluation database and quote_evaluation user created by scripts/eval-db.sh.");
  }
  return url;
}

function caseUrl(control: URL, database: string): string {
  const url = new URL(control.toString());
  url.pathname = `/${database}`;
  return url.toString();
}

function evaluationEnvironment(databaseUrl: string): EnvironmentSnapshot {
  const values: Record<string, string> = {
    // Production mode prevents the database/auth modules from loading .env.
    // The handler receives explicit dependencies, so these harmless values are
    // never used to contact an application database or provider.
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_URL: "http://evaluation.local",
    BETTER_AUTH_SECRET: "evaluation-only-secret-not-used-by-runner",
    AUTH_ALLOWED_EMAILS: "*",
    EMAIL_DELIVERY: "fake",
    QUOTE_AI_PROVIDER: "google",
    QUOTE_AI_MODEL: "gemini-2.5-flash",
    GEMINI_API_KEY: "evaluation-no-live-calls",
    QUOTE_AI_TIMEOUT_MS: "45000",
    QUOTE_AI_DEBUG: "true",
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return previous;
}

function restoreEnvironment(previous: EnvironmentSnapshot) {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/**
 * Clone the migrated evaluation template into a unique database. Nothing is
 * truncated or reset. A case either gets a new database or does not run.
 */
export async function openIsolatedEvaluationDatabase(controlUrl: string): Promise<EvaluationConnection> {
  const control = assertEvaluationControlUrl(controlUrl);
  const name = `quote_evaluation_case_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: control.toString(), max: 1, connectionTimeoutMillis: 5_000 });
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${evaluationDatabase}"`);
  } catch (error) {
    await admin.end();
    throw new Error(`Could not clone the evaluation database. Run scripts/eval-db.sh up first. ${error instanceof Error ? error.message : ""}`.trim());
  }
  await admin.end();

  const url = caseUrl(control, name);
  const environment = evaluationEnvironment(url);
  try {
    // These modules normally load dotenv in development. evaluationEnvironment
    // sets production before they are evaluated, so the runner never reads it.
    const { connectDatabase } = await import("../app/lib/db.server");
    const connection = connectDatabase(url);
    let closed = false;
    return {
      databaseUrl: url,
      database: connection.db,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await connection.pool.end();
        } finally {
          const dropper = new pg.Pool({ connectionString: control.toString(), max: 1, connectionTimeoutMillis: 5_000 });
          try {
            await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
          } finally {
            try {
              await dropper.end();
            } finally {
              restoreEnvironment(environment);
            }
          }
        }
      },
    };
  } catch (error) {
    restoreEnvironment(environment);
    const dropper = new pg.Pool({ connectionString: control.toString(), max: 1, connectionTimeoutMillis: 5_000 });
    try {
      await dropper.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await dropper.end();
    }
    throw error;
  }
}
