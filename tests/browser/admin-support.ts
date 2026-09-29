import { request, type Browser } from "@playwright/test";
import pg from "pg";

export const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180";
export const password = "browser-test-password";

/** Register a verified User through Better Auth. Only verification, and the optional role, are set directly. */
export async function createUser(name: string, { administrator = false } = {}) {
  const email = `admin-area-${crypto.randomUUID()}@example.com`;
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { "accept-language": "en-US" } });
  const database = new pg.Client({ connectionString: process.env.BROWSER_TEST_DATABASE_URL });
  try {
    const signUp = await api.post("/api/auth/sign-up/email", { data: { name, email, password, callbackURL: "/verify" } });
    if (!signUp.ok()) throw new Error(`Registration failed with ${signUp.status()}.`);
    await database.connect();
    await database.query('update "user" set email_verified = true, administrator = $2 where email = $1', [email, administrator]);
  } finally {
    await database.end().catch(() => undefined);
    await api.dispose();
  }
  return { name, email };
}

/** A browser context signed in through Better Auth's API, as the shared fixture does. */
export async function signedInContext(browser: Browser, email: string) {
  const api = await request.newContext({ baseURL });
  try {
    const signedIn = await api.post("/api/auth/sign-in/email", { data: { email, password, callbackURL: "/" } });
    if (!signedIn.ok()) throw new Error(`Sign-in failed with ${signedIn.status()}.`);
    return await browser.newContext({ locale: "en-US", storageState: await api.storageState() });
  } finally { await api.dispose(); }
}
