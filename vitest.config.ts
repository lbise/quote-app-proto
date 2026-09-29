import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Opt-in evaluation tests clone databases; bound concurrent PostgreSQL work.
    maxWorkers: process.env.EVAL_DATABASE_URL ? 2 : undefined,
    // Migrates the TEST_DATABASE_URL database before any test runs.
    globalSetup: ["./tests/vitest.global-setup.ts"],
    setupFiles: ["./tests/vitest.setup.ts"],
    include: ["app/**/*.test.ts", "eval/**/*.test.ts"],
  },
});
