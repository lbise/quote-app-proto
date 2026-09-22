import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
function command(...args: string[]) {
  return exec(process.execPath, ["--import", "tsx", "scripts/evaluate.ts", ...args], { env: { ...process.env, NODE_ENV: "production" }, timeout: 10_000 });
}
it("limits the no-op smoke command to full reconstructions", async () => {
  await expect(command("--offline-smoke", "--scenario", "joinery-injection-resistance", "--database-url", "invalid")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("reconstruction") });
});
it("does not let a contract suite turn offline smoke into a no-op", async () => {
  await expect(command("--offline-smoke", "--suite", "contract", "--database-url", "invalid"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("source-derived reconstruction") });
});

it("rejects unsafe repetition counts before any execution", async () => {
  await expect(command("--repetitions", "9".repeat(400))).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("positive integer") });
});
it("rejects mixed live and offline flags", async () => {
  await expect(command("--offline-smoke", "--live", "--scenario", "joinery-full-reconstruction")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("cannot be used together") });
});

it("requires an explicit scenario or suite selection before a live session can be configured", async () => {
  await expect(command("--live", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1", "--max-spend-usd", "1"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--scenario") });
});

it("treats a suite as an explicit live selection before provider configuration", async () => {
  await expect(command("--live", "--suite", "scenario"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--approve-provider-data-review") });
});

it("previews only selected contract checks without provider access", async () => {
  const result = await command("--suite", "contract");
  expect(result.stdout).toContain("contract-fixed-line [contract]");
  expect(result.stdout).toContain("contract-quantity-line [contract]");
  expect(result.stdout).toContain("contract-section-assignment [contract]");
  expect(result.stdout).toContain("contract-multi-paragraph-facts [contract]");
  expect(result.stdout).toContain("contract-mixed-batches [contract]");
  expect(result.stdout).toContain("No provider call was made");
});

it("fails closed for invalid suites and unknown or suite-mismatched scenario IDs", async () => {
  await expect(command("--suite", "everything"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--suite must be contract or scenario") });
  await expect(command("--suite", "contract", "--scenario", "joinery-panel-correction"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("not in the contract suite") });
  await expect(command("--suite", "contract", "--scenario", "does-not-exist"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("Unknown scenario ID") });
});

it("requires provider-data approval before reading credentials or executing a scenario", async () => {
  await expect(command("--live", "--scenario", "joinery-full-reconstruction", "--provider-env-file", "does-not-exist", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1", "--max-spend-usd", "1"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--approve-provider-data-review") });
});

it("selects only explicit provider environment and lets exported variables override the env file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-cli-env-"));
  const path = join(directory, ".env");
  try {
    await writeFile(path, "QUOTE_AI_PROVIDER=google\nQUOTE_AI_MODEL=gemini-2.5-flash\nGEMINI_API_KEY=controlled-no-provider-calls\nDATABASE_URL=must-not-be-used\n");
    const args = ["--import", "tsx", "scripts/evaluate.ts", "--live", "--scenario", "joinery-full-reconstruction", "--provider-env-file", path,
      "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1000", "--max-spend-usd", "1"];
    const env = { ...process.env, NODE_ENV: "production", QUOTE_AI_PROVIDER: undefined, QUOTE_AI_MODEL: undefined, GEMINI_API_KEY: undefined, QUOTE_AI_TIMEOUT_MS: undefined };
    await expect(exec(process.execPath, args, { env, timeout: 10000 })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("Live pricing supports only") });
    await expect(exec(process.execPath, args, { env: { ...env, QUOTE_AI_PROVIDER: "unregistered" }, timeout: 10000 }))
      .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("registered provider") });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("rejects controlled-only scenarios before configuring a live provider", async () => {
  await expect(command("--live", "--scenario", "joinery-third-failure-discard", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1", "--max-spend-usd", "1"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("controlled-only") });
});

it("rejects live bounds that exceed the CLI safety ceiling", async () => {
  await expect(command("--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "10001", "--max-elapsed-ms", "1", "--max-spend-usd", "1"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--max-calls") });
  await expect(command("--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "3600001", "--max-spend-usd", "1"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--max-elapsed-ms") });
  await expect(command("--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1", "--max-spend-usd", "1000000.000000001"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--max-spend-usd") });
});

it("documents suite selection in help", async () => {
  const result = await command("--help");
  expect(result.stdout).toContain("--suite contract|scenario");
});

it("rejects environment files outside live evaluation", async () => {
  await expect(command("--provider-env-file", "must-not-read.env")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider-env-file") });
  await expect(command("--offline-smoke", "--scenario", "joinery-full-reconstruction", "--database-url", "invalid", "--provider-env-file", "must-not-read.env")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider-env-file") });
});
