import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { assertEvaluationControlUrl } from "../eval/isolation";

// The dashboard must never inherit an application connection, even if .env or
// the invoking shell contains one. Migration runs with NODE_ENV=production.
process.env.NODE_ENV = "production";
delete process.env.DATABASE_URL;
delete process.env.TEST_DATABASE_URL;

const { values } = parseArgs({ options: {
  root: { type: "string", default: ".eval-artifacts" },
  port: { type: "string", default: process.env.EVAL_DASHBOARD_PORT ?? "4320" },
}, strict: true });
const port = Number(values.port);
if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("Dashboard port must be an integer from 1024 to 65535.");
  process.exit(1);
}

const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
// Never forward an application database URL to any provisioning subprocess.
delete childEnv.DATABASE_URL;
delete childEnv.TEST_DATABASE_URL;
function evalDb(action: "ensure" | "url") {
  return execFileSync("bash", ["scripts/eval-db.sh", action], {
    cwd: resolve(import.meta.dirname, ".."), env: childEnv, encoding: "utf8", timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function main() {
  try {
    evalDb("ensure");
  } catch {
    throw new Error("Evaluation database setup failed. Start Docker, check the evaluation container and run npm run eval:db -- ensure for details. The dashboard was not started.");
  }
  let databaseUrl: string;
  try {
    databaseUrl = assertEvaluationControlUrl(evalDb("url")).toString();
  } catch {
    throw new Error("Could not obtain the dedicated local evaluation database URL. The dashboard was not started.");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  try {
    const journal = JSON.parse(readFileSync(resolve(import.meta.dirname, "../drizzle/meta/_journal.json"), "utf8")) as { entries: unknown[] };
    const { rows } = await pool.query<{ quote: string | null; customer: string | null; revision: string | null; installation: string | null; migrations: string | null }>(
      "SELECT to_regclass('public.quote') AS quote, to_regclass('public.customer') AS customer, to_regclass('public.quote_revision') AS revision, to_regclass('public.app_installation') AS installation, to_regclass('drizzle.__drizzle_migrations') AS migrations",
    );
    if (!rows[0] || Object.values(rows[0]).some(value => value === null)) throw new Error("missing schema");
    const migrationCount = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations");
    if (Number(migrationCount.rows[0]?.count) < journal.entries.length) throw new Error("incomplete migrations");
  } catch {
    throw new Error("Evaluation database readiness or schema verification failed. The dashboard was not started.");
  } finally {
    await pool.end();
  }

  const { createEvaluatorServer } = await import("../eval/server");
  const { scenarios } = await import("../eval/scenarios");
  const providerAvailable = process.env.QUOTE_AI_PROVIDER === "google" && process.env.QUOTE_AI_MODEL === "gemini-3.5-flash-lite" && Boolean(process.env.GEMINI_API_KEY);
  const server = createEvaluatorServer({ root: resolve(values.root), scenarios, databaseUrl, providerAvailable });
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolveListening(); });
  });
  console.log(`Evaluator dashboard: http://127.0.0.1:${port}\nLocal only. Press Ctrl-C to stop. Saved evaluations remain on disk.`);
}

main().catch(error => {
  // Neither provider errors nor database exceptions may disclose URLs or paths.
  const safe = error instanceof Error && (
    error.message.startsWith("Evaluation database setup failed.") ||
    error.message.startsWith("Could not obtain the dedicated local") ||
    error.message.startsWith("Evaluation database readiness") ||
    error.message.startsWith("Executable evaluator server is unavailable."));
  console.error(safe ? error.message : "Evaluator startup failed. Check the dashboard port and server configuration. No application database fallback.");
  process.exitCode = 1;
});
