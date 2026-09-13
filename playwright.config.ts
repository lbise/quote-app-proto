import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180";
const configuredBrowserDatabaseUrl = process.env.BROWSER_TEST_DATABASE_URL;
const sourceDatabaseUrl = configuredBrowserDatabaseUrl ?? process.env.DATABASE_URL;

if (!sourceDatabaseUrl) {
  throw new Error("DATABASE_URL is required for browser tests.");
}

const browserDatabase = new URL(sourceDatabaseUrl);
if (!configuredBrowserDatabaseUrl) {
  browserDatabase.pathname = `${browserDatabase.pathname.replace(/\/$/, "")}_browser`;
}
const browserDatabaseUrl = browserDatabase.toString();

// Test workers and the server must use the same isolated database.
process.env.BROWSER_TEST_DATABASE_URL = browserDatabaseUrl;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort",
    url: `${baseURL}/health/live`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      DATABASE_URL: browserDatabaseUrl,
      BETTER_AUTH_URL: baseURL,
      AUTH_TRUSTED_ORIGINS: baseURL,
      // browser@example.com documents the browser-test identity. The isolated
      // database also permits unique fixture accounts across repeated runs.
      AUTH_ALLOWED_EMAILS: "browser@example.com *",
      EMAIL_DELIVERY: "fake",
      QUOTE_AI_ENABLED: "false",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "browser-test-secret-browser-test-secret",
    },
  },
});
