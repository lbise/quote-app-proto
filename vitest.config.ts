import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Opt-in evaluation tests clone databases; bound concurrent PostgreSQL work.
    maxWorkers: process.env.EVAL_DATABASE_URL ? 2 : undefined,
    setupFiles: ["./tests/vitest.setup.ts"],
    include: ["app/**/*.test.ts", "eval/**/*.test.ts"],
  },
});
