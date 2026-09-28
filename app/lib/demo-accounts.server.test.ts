import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { artisan, customer, quote, user } from "./db/schema";
import { DemoAccountError, parseDemoAccounts, seedDemoAccounts } from "./demo-accounts.server";
import { createQuoteHandler } from "./quotes.server";

const origin = "http://localhost:5173";
const script = fileURLToPath(new URL("../../scripts/seed-demo.ts", import.meta.url));

describe("parseDemoAccounts", () => {
  it("reads whitespace-separated email:password entries and normalizes emails", () => {
    expect(parseDemoAccounts(" Demo1@Example.test:first-pass\n demo2@example.test:pa:ss:word ", "*")).toEqual([
      { email: "demo1@example.test", password: "first-pass" },
      { email: "demo2@example.test", password: "pa:ss:word" },
    ]);
  });

  it("rejects missing, malformed, duplicate or unapproved entries without echoing passwords", () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, "DEMO_ACCOUNTS is empty"],
      ["  ", "DEMO_ACCOUNTS is empty"],
      ["demo@example.test", "email:password"],
      ["not-an-email:long-enough-password", "valid email"],
      ["demo@example.test:short", "8 and 128"],
      [`demo@example.test:${"x".repeat(129)}`, "8 and 128"],
      ["demo@example.test:first-pass DEMO@example.test:second-pass", "more than once"],
      ["other@example.test:secret-password", "AUTH_ALLOWED_EMAILS"],
    ];
    for (const [value, message] of cases) {
      let error: unknown;
      try { parseDemoAccounts(value, "demo@example.test"); } catch (caught) { error = caught; }
      expect(error, value).toBeInstanceOf(DemoAccountError);
      expect((error as Error).message).toContain(message);
      for (const secret of ["short", "secret-password", "long-enough-password", "first-pass"]) {
        expect((error as Error).message).not.toContain(secret);
      }
    }
  });
});

function runScript(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), script, ...args], {
      env: { ...process.env, EMAIL_DELIVERY: "fake", ...env }, stdio: "pipe",
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("seed-demo did not finish.")); }, 20_000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

it("refuses unknown arguments before touching the database", async () => {
  const result = await runScript(["--wipe"], { DATABASE_URL: "postgresql://localhost:1/none", DEMO_ACCOUNTS: "demo@example.test:long-password" });
  expect(result.code).toBe(1);
  expect(result.output).toContain("--reset");
  expect(result.output).not.toContain("long-password");
});

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("seedDemoAccounts", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const originalAllowlist = process.env.AUTH_ALLOWED_EMAILS;
  const originalDelivery = process.env.EMAIL_DELIVERY;
  const emails: string[] = [];
  let ip = 0;
  const subnet = 1 + Math.floor(Math.random() * 250);

  function demoEmail(label: string) {
    const email = `demo-${label}-${crypto.randomUUID()}@example.test`;
    emails.push(email);
    return email;
  }

  async function signIn(email: string, password: string) {
    return auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `127.1.${subnet}.${++ip}` },
      body: JSON.stringify({ email, password }),
    }));
  }

  async function quotesFor(response: Response) {
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const handler = createQuoteHandler({ database: connection.db, auth });
    return handler(new Request(`${origin}/api/quotes`, { headers: { cookie } }));
  }

  async function businessIdFor(email: string) {
    const [row] = await connection.db.select({ businessId: artisan.businessId }).from(artisan)
      .innerJoin(user, eq(user.id, artisan.userId)).where(eq(user.email, email));
    return row?.businessId;
  }

  beforeAll(() => {
    process.env.AUTH_ALLOWED_EMAILS = "*";
    process.env.EMAIL_DELIVERY = "fake";
  });

  afterAll(async () => {
    if (originalAllowlist === undefined) delete process.env.AUTH_ALLOWED_EMAILS;
    else process.env.AUTH_ALLOWED_EMAILS = originalAllowlist;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    if (emails.length) await connection.db.delete(user).where(inArray(user.email, emails));
    await connection.pool.end();
  });

  it("creates verified demo accounts with an empty workspace and leaves existing ones unchanged", async () => {
    const email = demoEmail("create");
    const first = await seedDemoAccounts({ database: connection.db, auth, accounts: [{ email, password: "first-password" }] });
    expect(first).toEqual([{ email, result: "created" }]);

    const signedIn = await signIn(email, "first-password");
    expect(signedIn.status).toBe(200);
    expect((await signedIn.json()).user.emailVerified).toBe(true);
    const quotes = await quotesFor(signedIn);
    expect(quotes.status).toBe(200);
    expect((await quotes.json()).quotes).toEqual([]);

    const businessId = await businessIdFor(email);
    await connection.db.insert(customer).values({ id: crypto.randomUUID(), businessId: businessId!, name: "Kept", address: "Here" });
    const again = await seedDemoAccounts({ database: connection.db, auth, accounts: [{ email, password: "changed-password" }] });
    expect(again).toEqual([{ email, result: "unchanged" }]);
    expect((await signIn(email, "first-password")).status).toBe(200);
    expect(await connection.db.select().from(customer).where(eq(customer.businessId, businessId!))).toHaveLength(1);
  });

  it("resets demo accounts to an empty workspace, revokes sessions and applies the configured password", async () => {
    const email = demoEmail("reset");
    await seedDemoAccounts({ database: connection.db, auth, accounts: [{ email, password: "first-password" }] });
    const before = await signIn(email, "first-password");
    expect(before.status).toBe(200);
    const oldBusinessId = await businessIdFor(email);
    await connection.db.insert(customer).values({ id: crypto.randomUUID(), businessId: oldBusinessId!, name: "Prospect data", address: "Somewhere" });
    await connection.db.insert(quote).values({ id: crypto.randomUUID(), businessId: oldBusinessId!, reference: "D-1" });

    const reset = await seedDemoAccounts({ database: connection.db, auth, accounts: [{ email, password: "second-password" }], reset: true });
    expect(reset).toEqual([{ email, result: "reset" }]);

    expect(await connection.db.select().from(customer).where(eq(customer.businessId, oldBusinessId!))).toEqual([]);
    expect(await connection.db.select().from(quote).where(eq(quote.businessId, oldBusinessId!))).toEqual([]);
    expect((await quotesFor(before)).status).toBe(401);
    expect((await signIn(email, "first-password")).status).not.toBe(200);
    const after = await signIn(email, "second-password");
    expect(after.status).toBe(200);
    expect((await (await quotesFor(after)).json()).quotes).toEqual([]);
  });

  it("creates missing accounts during a reset", async () => {
    const email = demoEmail("reset-missing");
    expect(await seedDemoAccounts({ database: connection.db, auth, accounts: [{ email, password: "first-password" }], reset: true }))
      .toEqual([{ email, result: "created" }]);
    expect((await signIn(email, "first-password")).status).toBe(200);
  });

  it("never changes a real account that shares an email, and writes nothing for the batch", async () => {
    const realEmail = demoEmail("real");
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `127.1.${subnet}.${++ip}` },
      body: JSON.stringify({ name: "Real Artisan", email: realEmail, password: "real-password" }),
    }));
    expect(signedUp.status).toBe(200);
    const realUserId = (await signedUp.json()).user.id;
    const businessId = await businessIdFor(realEmail);
    await connection.db.insert(customer).values({ id: crypto.randomUUID(), businessId: businessId!, name: "Real customer", address: "Real" });
    const otherEmail = demoEmail("batch");

    for (const reset of [false, true]) {
      await expect(seedDemoAccounts({
        database: connection.db, auth, reset,
        accounts: [{ email: otherEmail, password: "other-password" }, { email: realEmail, password: "demo-password" }],
      })).rejects.toThrow(/not a demo account/);
    }

    expect(await connection.db.select().from(user).where(eq(user.email, otherEmail))).toEqual([]);
    const [real] = await connection.db.select().from(user).where(eq(user.id, realUserId));
    expect(real?.email).toBe(realEmail);
    expect(await connection.db.select().from(customer).where(eq(customer.businessId, businessId!))).toHaveLength(1);
  });

  it("runs from the command line without printing passwords", async () => {
    const email = demoEmail("cli");
    const env = { DATABASE_URL: process.env.TEST_DATABASE_URL, AUTH_ALLOWED_EMAILS: email, DEMO_ACCOUNTS: `${email}:cli-first-password` };
    const created = await runScript([], env);
    expect(created.code, created.output).toBe(0);
    expect(created.output).toContain(`${email}: created`);
    const reset = await runScript(["--reset"], { ...env, DEMO_ACCOUNTS: `${email}:cli-second-password` });
    expect(reset.code, reset.output).toBe(0);
    expect(reset.output).toContain(`${email}: reset`);
    for (const output of [created.output, reset.output]) expect(output).not.toMatch(/cli-(first|second)-password/);
    expect((await signIn(email, "cli-second-password")).status).toBe(200);
  }, 45_000);
});
