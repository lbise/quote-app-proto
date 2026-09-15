import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("server startup", () => {
  it("rejects an invalid enabled Quote AI configuration before serving requests", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./app/entry.server.tsx')"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "development",
        QUOTE_AI_ENABLED: "true",
        QUOTE_AI_PROVIDER: "google",
        QUOTE_AI_MODEL: "gemini-2.5-flash",
        GEMINI_API_KEY: "",
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain("GEMINI_API_KEY is required");
  });
});
