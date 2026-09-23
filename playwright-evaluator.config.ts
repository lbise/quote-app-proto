import { defineConfig, devices } from "@playwright/test";

// A separate suite: no application dev server, .env, production credentials or provider calls.
if (!process.env.EVAL_DATABASE_URL) throw new Error("Set EVAL_DATABASE_URL to the disposable evaluation database for dashboard browser tests.");
export default defineConfig({
  testDir: "./tests/evaluator",
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
});
