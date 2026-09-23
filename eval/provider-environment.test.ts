import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readProviderEnvironment } from "./provider-environment";

afterEach(() => vi.unstubAllEnvs());

it("reads only server-side provider settings, with process values winning over the file", () => {
  const directory = mkdtempSync(join(tmpdir(), "eval-env-test-"));
  try {
    const path = join(directory, ".env");
    writeFileSync(path, "OPENROUTER_API_KEY=from-file\nQUOTE_AI_PROVIDER=openrouter\nDATABASE_URL=must-not-leak\nUNRELATED_SECRET=must-not-leak\n");
    vi.stubEnv("OPENROUTER_API_KEY", "from-process");
    const result = readProviderEnvironment({ file: path });
    expect(result.OPENROUTER_API_KEY).toBe("from-process");
    expect(result).not.toHaveProperty("DATABASE_URL");
    expect(result).not.toHaveProperty("UNRELATED_SECRET");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
