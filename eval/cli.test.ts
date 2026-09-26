import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { listEvaluationSessions, reconcileEvaluationSessions } from "./sessions";
import { listRuns } from "./artifacts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
const exec = promisify(execFile);
// Each test starts one or more `tsx` CLI processes, sequentially, bounded by their own 10 s timeout.
// A cold start takes over a second on CI, so the 5 s default flakes on tests that start several.
vi.setConfig({ testTimeout: 30_000 });
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

it.each(["0", "-1", "0.0000000001", "1.0000000001", "1000000.000000001", "NaN", "Infinity", "1e-9"])("rejects invalid CLI decimal USD text %s before configuration", async maxSpendUsd => {
  await expect(command("--max-spend-usd", maxSpendUsd)).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--max-spend-usd must be a positive amount") });
});

it("rejects an unsupported reasoning claim and output bound before credentials or requests", async () => {
  const flags = ["--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1000", "--max-spend-usd", "1"];
  await expect(command(...flags, "--reasoning", "off")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("off is unsupported") });
  await expect(command(...flags, "--reasoning", "low", "--max-output-tokens", "4097")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--max-output-tokens") });
});

it.each(["1", "4.1", "8.2", "16.4", "0.000000001", "1000000"])("retains decimal USD cap %s and failed-to-start work through CLI exit and reopening", async maxSpendUsd => {
  const directory = await mkdtemp(join(tmpdir(), "eval-cli-session-"));
  try {
    const env = { ...process.env, QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "local-fake-key", QUOTE_AI_TIMEOUT_MS: "1000" };
    await expect(exec(process.execPath, ["--import", "tsx", "--import", "data:text/javascript,Date.now=()=>Date.parse('2026-09-22T12:00:00Z')", "scripts/evaluate.ts", "--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "10000", "--max-spend-usd", maxSpendUsd, "--reasoning", "low", "--artifacts", directory], { env, timeout: 10000 }))
      .rejects.toMatchObject({ code: 2 });
    const [record] = listEvaluationSessions(directory);
    expect(record.plan.work).toHaveLength(1);
    expect(record.plan.limits?.maxSpendUsd).toBe(Number(maxSpendUsd));
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

it("requires an exact model with explicit OpenRouter CLI selection and never uses the Google key", async () => {
  const flags = ["--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid", "--max-calls", "1", "--max-elapsed-ms", "1000", "--max-spend-usd", "1"];
  await expect(command(...flags, "--provider", "openrouter"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--model") });
  const env = { ...process.env, QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "google-test-key", OPENROUTER_API_KEY: undefined };
  await expect(exec(process.execPath, ["--import", "tsx", "scripts/evaluate.ts", ...flags, "--provider", "openrouter", "--model", "example/text-model"], { env, timeout: 10000 }))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("OPENROUTER_API_KEY") });
});

it("forwards verified OpenRouter model and requested generation into a persisted live session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-cli-router-"));
  const id = "example/text-model";
  const setup = `globalThis.fetch = async (input) => {
    const id = 'example/text-model';
    if (String(input) === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id, name: 'Text model', context_length: 8192, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools', 'max_tokens'] }] });
    if (String(input) === 'https://openrouter.ai/api/v1/models/' + id + '/endpoints') return Response.json({ data: { id, endpoints: [{ name: 'Provider A', model_id: id, provider_name: 'Provider A', context_length: 8192, max_completion_tokens: 2048, supported_parameters: ['tools', 'max_tokens'], status: 0, pricing: { prompt: '0.000001', completion: '0.000002', input_cache_read: '0', input_cache_write: '0' } }] } });
    throw new Error('Unexpected external request');
  };`;
  try {
    const env = { ...process.env, OPENROUTER_API_KEY: "fake-router-key", GEMINI_API_KEY: undefined };
    await expect(exec(process.execPath, ["--import", "tsx", "--import", `data:text/javascript,${encodeURIComponent(setup)}`, "scripts/evaluate.ts",
      "--live", "--scenario", "joinery-full-reconstruction", "--approve-provider-data-review", "--database-url", "invalid",
      "--max-calls", "1", "--max-elapsed-ms", "10000", "--max-spend-usd", "100", "--artifacts", directory,
      "--provider", "openrouter", "--model", id, "--reasoning", "off", "--max-output-tokens", "128"], { env, timeout: 10000 }))
      .rejects.toMatchObject({ code: 2 });
    const [record] = listEvaluationSessions(directory);
    expect(record.plan.model).toMatchObject({ provider: "openrouter", id, requested: { reasoning: "off", maxOutputTokens: 128 }, effective: { reasoning: "off", maxOutputTokens: 128 } });
    expect(JSON.stringify(record)).not.toContain("fake-router-key");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.skipIf(!process.env.EVAL_DATABASE_URL)("runs the CLI OpenRouter selection through the real agent and isolated database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-cli-router-real-"));
  const id = "example/cli-tools";
  const setup = `globalThis.fetch = async (input, init) => {
    const id = 'example/cli-tools';
    if (String(input) === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [{ id, name: 'CLI tools', context_length: 65536, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools', 'max_tokens'] }] });
    if (String(input) === 'https://openrouter.ai/api/v1/models/' + id + '/endpoints') return Response.json({ data: { id, endpoints: [{ name: 'Provider A', model_id: id, provider_name: 'Provider A', context_length: 65536, max_completion_tokens: 2048, supported_parameters: ['tools', 'max_tokens'], status: 0, supports_implicit_caching: false, pricing: { prompt: '0.000001', completion: '0.000002', request: '0.0001' } }] } });
    if (String(input) === 'https://openrouter.ai/api/v1/chat/completions') {
      const body = JSON.parse(String(init?.body));
      if (body.model !== id || body.max_tokens !== 128 || body.provider?.require_parameters !== true) throw Error('Unbounded request');
      const first = { id: 'generation', model: id, choices: [{ index: 0, delta: { content: 'No change.' }, finish_reason: 'stop' }] };
      const last = { id: 'generation', model: id, choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } };
      return new Response('data: ' + JSON.stringify(first) + '\\n\\ndata: ' + JSON.stringify(last) + '\\n\\ndata: [DONE]\\n\\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    throw Error('Unexpected external request');
  };`;
  try {
    const env = { ...process.env, NODE_ENV: "production", OPENROUTER_API_KEY: "cli-test-secret", GEMINI_API_KEY: undefined };
    await expect(exec(process.execPath, ["--import", "tsx", "--import", `data:text/javascript,${encodeURIComponent(setup)}`, "scripts/evaluate.ts",
      "--live", "--scenario", "contract-fixed-line", "--approve-provider-data-review", "--database-url", process.env.EVAL_DATABASE_URL!,
      "--max-calls", "1", "--max-elapsed-ms", "30000", "--max-spend-usd", "1", "--artifacts", directory,
      "--provider", "openrouter", "--model", id, "--reasoning", "off", "--max-output-tokens", "128"], { env, timeout: 30000 }))
      .rejects.toMatchObject({ code: 1 }); // A controlled no-op fails the commercial assertion, not execution.
    const [record] = listEvaluationSessions(directory);
    const [run] = await listRuns(directory);
    expect(record.state).toMatchObject({ status: "completed", calls: 1 });
    expect(run).toMatchObject({ sessionId: record.plan.id, automated: "failed", modelCalls: 1,
      model: { provider: "openrouter", id }, usage: { input: 120, output: 30 }, live: { calls: [{ status: "complete" }] } });
    expect(JSON.stringify({ record, run })).not.toContain("cli-test-secret");
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 40_000);

it("rejects invalid provider CLI values before credentials", async () => {
  await expect(command("--provider", "other", "--model", "example/text-model"))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider must be google or openrouter") });
});

it("documents suite selection in help", async () => {
  const result = await command("--help");
  expect(result.stdout).toContain("--suite contract|scenario");
});

it("rejects environment files outside live evaluation", async () => {
  await expect(command("--provider-env-file", "must-not-read.env")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider-env-file") });
  await expect(command("--offline-smoke", "--scenario", "joinery-full-reconstruction", "--database-url", "invalid", "--provider-env-file", "must-not-read.env")).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("--provider-env-file") });
});
