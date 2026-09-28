import { eq, inArray } from "drizzle-orm";

import { isEmailAllowed, normalizeEmail } from "./auth-config.server";
import type { createAuthForDatabase } from "./auth.server";
import type { Database } from "./db.server";
import { demoAccount, user } from "./db/schema";

export type DemoAccount = { email: string; password: string };
export type DemoAccountResult = { email: string; result: "created" | "unchanged" | "reset" };

/** A configuration or safety error whose message is safe to print. It never contains a password. */
export class DemoAccountError extends Error {}

/**
 * Parse DEMO_ACCOUNTS: whitespace-separated `email:password` entries. The
 * password is everything after the first colon, so it may contain colons but
 * not whitespace.
 */
export function parseDemoAccounts(value: string | undefined, allowlist?: string): DemoAccount[] {
  const entries = (value ?? "").split(/\s+/).filter(Boolean);
  if (!entries.length) throw new DemoAccountError("DEMO_ACCOUNTS is empty. Set it to space-separated email:password entries.");
  const seen = new Set<string>();
  return entries.map((entry, index) => {
    const separator = entry.indexOf(":");
    if (separator < 1) throw new DemoAccountError(`DEMO_ACCOUNTS entry ${index + 1} must use the form email:password.`);
    const email = normalizeEmail(entry.slice(0, separator));
    const password = entry.slice(separator + 1);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new DemoAccountError(`DEMO_ACCOUNTS entry ${index + 1} does not start with a valid email address.`);
    }
    if (password.length < 8 || password.length > 128) {
      throw new DemoAccountError(`The password for ${email} must be between 8 and 128 characters.`);
    }
    if (seen.has(email)) throw new DemoAccountError(`${email} appears more than once in DEMO_ACCOUNTS.`);
    seen.add(email);
    if (!isEmailAllowed(email, allowlist)) {
      throw new DemoAccountError(`${email} is not in AUTH_ALLOWED_EMAILS. Add it there first, or the account cannot sign in.`);
    }
    return { email, password };
  });
}

/**
 * Create each missing demo account as a verified Artisan with an empty
 * Artisan Business. Existing demo accounts are left unchanged, unless `reset`
 * is set: then the account and everything it owns is deleted and recreated
 * with the configured password, which also signs out every session.
 *
 * Accounts not created by this seeder are never modified. If any listed email
 * belongs to one, nothing is written.
 */
export async function seedDemoAccounts({ database, auth, accounts, reset = false }: {
  database: Database;
  auth: ReturnType<typeof createAuthForDatabase>;
  accounts: DemoAccount[];
  reset?: boolean;
}): Promise<DemoAccountResult[]> {
  const existing = accounts.length ? await database
    .select({ id: user.id, email: user.email, demo: demoAccount.userId })
    .from(user)
    .leftJoin(demoAccount, eq(demoAccount.userId, user.id))
    .where(inArray(user.email, accounts.map((account) => account.email))) : [];
  const realAccount = existing.find((row) => !row.demo);
  if (realAccount) {
    throw new DemoAccountError(`${realAccount.email} already exists and is not a demo account. No accounts were changed.`);
  }

  const context = await auth.$context;
  const results: DemoAccountResult[] = [];
  for (const { email, password } of accounts) {
    const current = existing.find((row) => row.email === email);
    if (current && !reset) {
      results.push({ email, result: "unchanged" });
      continue;
    }
    // Hash first so a hashing failure cannot leave a reset account deleted.
    const hash = await context.password.hash(password);
    // Cascades remove the Artisan Business, its Customers and Quotes, and sessions.
    if (current) await database.delete(user).where(eq(user.id, current.id));
    // The user-create hook enforces the allowlist and provisions the business.
    // No verification email is sent: the account is created already verified.
    const created = await context.internalAdapter.createUser({ email, name: "Demo", emailVerified: true }, { method: "email-password" });
    if (!created) throw new DemoAccountError(`${email} could not be created. Run the command again.`);
    await context.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: hash });
    await database.insert(demoAccount).values({ userId: created.id });
    results.push({ email, result: current ? "reset" : "created" });
  }
  return results;
}
