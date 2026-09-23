import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { listEvaluationSessions, reconcileEvaluationSessions } from "./sessions";
import { listRuns } from "./artifacts";
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

it("rejects an unsupported reasoning claim and output bound before credentials or requests", async () => {
  const flags = ["--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1000", "--max-spend-usd", "1"];
  await expect(command(...flags, "--reasoning", "off")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("off is unsupported") });
  await expect(command(...flags, "--reasoning", "low", "--max-output-tokens", "4097")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--max-output-tokens") });
});

it("records failed-to-start work from a CLI subprocess and keeps it interrupted only when unfinished", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-cli-session-"));
  try {
    const env = { ...process.env, QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "local-fake-key", QUOTE_AI_TIMEOUT_MS: "1000" };
    await expect(exec(process.execPath, ["--import", "tsx", "scripts/evaluate.ts", "--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "10000", "--max-spend-usd", "1", "--reasoning", "low", "--artifacts", directory], { env, timeout: 10000 }))
      .rejects.toMatchObject({ code: 2 });
    const [record] = listEvaluationSessions(directory);
    expect(record.plan.work).toHaveLength(1);
    expect(record.plan.model.effective).toMatchObject({ reasoning: "low" });
    expect(record.state.status).toBe("failed-to-start");
    expect(record.state.work[0].status).toBe("interrupted");
    expect(record.state.calls).toBe(0);
    const reopening = await exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "import { reconcileEvaluationSessions } from './eval/sessions.ts'; console.log(JSON.stringify(reconcileEvaluationSessions(process.argv[1])[0].state));", directory],
      { env, timeout: 10000 });
    expect(JSON.parse(reopening.stdout).status).toBe("failed-to-start");
    expect(listEvaluationSessions(directory)[0].state.calls).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.skipIf(!process.env.EVAL_DATABASE_URL)("retains each repetition and its run reference through CLI exit and reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-cli-smoke-"));
  try {
    const result = await command("--offline-smoke", "--scenario", "joinery-full-reconstruction", "--database-url", process.env.EVAL_DATABASE_URL!, "--repetitions", "2", "--artifacts", directory);
    expect(result.stdout).toContain("Offline smoke session");
    const [record] = reconcileEvaluationSessions(directory);
    expect(record.plan.work.map(item => item.repetition)).toEqual([1, 2]);
    expect(record.state.status).toBe("completed");
    expect(record.state.work.map(item => item.status)).toEqual(["completed", "completed"]);
    const runs = await listRuns(directory);
    expect(runs.map(run => run.sessionId)).toEqual([record.plan.id, record.plan.id]);
    expect(runs.map(run => run.id).sort()).toEqual(record.state.work.map(item => item.runId).sort());
    expect(runs.every(run => run.automated === "failed")).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("documents suite selection in help", async () => {
  const result = await command("--help");
  expect(result.stdout).toContain("--suite contract|scenario");
});

it("rejects environment files outside live evaluation", async () => {
  await expect(command("--provider-env-file", "must-not-read.env")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider-env-file") });
  await expect(command("--offline-smoke", "--scenario", "joinery-full-reconstruction", "--database-url", "invalid", "--provider-env-file", "must-not-read.env")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider-env-file") });
});
