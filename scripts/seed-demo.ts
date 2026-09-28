// Create or reset demo accounts from DEMO_ACCOUNTS. Run inside the deployed
// container (see docs/deployment.md) or locally against the .env database.
import { DemoAccountError, parseDemoAccounts, seedDemoAccounts } from "../app/lib/demo-accounts.server";

const usage = "Usage: npm run seed:demo [-- --reset]. Accounts and passwords come from DEMO_ACCOUNTS.";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--reset")) throw new DemoAccountError(usage);
  const reset = args.includes("--reset");

  // Importing the database module loads .env outside production.
  const { connectDatabase } = await import("../app/lib/db.server");
  const accounts = parseDemoAccounts(process.env.DEMO_ACCOUNTS);
  if (!process.env.DATABASE_URL) throw new DemoAccountError("DATABASE_URL is required.");
  const { createAuthForDatabase } = await import("../app/lib/auth.server");
  const connection = connectDatabase(process.env.DATABASE_URL);
  try {
    const results = await seedDemoAccounts({ database: connection.db, auth: createAuthForDatabase(connection.db), accounts, reset });
    for (const { email, result } of results) console.info(`${email}: ${result}`);
    if (!reset && results.some(({ result }) => result === "unchanged")) {
      console.info("Existing demo accounts keep their data and password. Use --reset to empty them and apply DEMO_ACCOUNTS passwords.");
    }
  } finally {
    await connection.pool.end();
  }
}

main().catch((error) => {
  // Other errors may carry configuration details, so print a generic message.
  console.error(error instanceof DemoAccountError
    ? error.message
    : "Demo account seeding failed. Check DATABASE_URL, that migrations have run, and the auth configuration.");
  process.exitCode = 1;
});
