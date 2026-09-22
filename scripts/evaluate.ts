import { readFileSync } from "node:fs";

import { parse as parseDotenv } from "dotenv";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

import { configuredQuoteAI } from "../app/lib/quote-ai-config.server";
import { saveRun } from "../eval/artifacts";
import { createLiveSession } from "../eval/live";
import { runScenario } from "../eval/runner";
import { scenarios } from "../eval/scenarios";
import type { Scenario } from "../eval/types";

const help = `Usage: npm run eval:run -- [options]

  --scenario ID                 Select one scenario. Repeat for several scenarios.
  --repetitions N               Run each selected scenario N times. Default: 1.
  --artifacts PATH              Local artifact directory. Default: .eval-artifacts.
  --offline-smoke               Run one source-derived reconstruction with a controlled faux no-op reply.
  --database-url URL            Dedicated URL printed by npm run eval:db -- up.
  --live                        Request a live provider evaluation.
  --approve-provider-data-review Required with --live.
  --max-calls N                 Required with --live.
  --max-elapsed-ms N            Required with --live.
  --max-spend-usd USD           Required with --live; at most 1000000 with up to 9 decimal places.
  --provider-env-file PATH      Read only provider variables from PATH, after live approval.
  --help                        Show this help.

Offline smoke uses createQuoteHandler, the registered tools, and a fresh PostgreSQL case database. It saves a faux-controlled artifact and intentionally fails reconstruction assertions. It never calls a provider.

Live evaluation requires an explicit scenario selection, runtime provider-data approval, a dedicated database, and bounded calls, elapsed time, and spend. It supports only the registered Google gemini-3.5-flash-lite boundary; other provider/model selections fail closed.`;

type Arguments = {
  scenarioIds: string[];
  repetitions: number;
  artifactRoot: string;
  databaseUrl?: string;
  offlineSmoke: boolean;
  live: boolean;
  approvedProviderDataReview: boolean;
  maxCalls?: number;
  maxElapsedMs?: number;
  maxSpendUsd?: number;
  envFile?: string;
  help: boolean;
};

function fail(message: string): never {
  throw new Error(message);
}

function positiveInteger(name: string, value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail(`${name} must be a positive integer.`);
  return Number(value);
}

function positiveUsd(value: string): number {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1_000_000) {
    fail("--max-spend-usd must be a positive amount up to 1000000 with at most 9 decimal places.");
  }
  return Number(value);
}

function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    scenarioIds: [], repetitions: 1, artifactRoot: ".eval-artifacts", offlineSmoke: false,
    live: false, approvedProviderDataReview: false, help: false,
  };
  const singleValues = new Set(["--repetitions", "--artifacts", "--database-url", "--max-calls", "--max-elapsed-ms", "--max-spend-usd", "--provider-env-file"]);
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") { parsed.help = true; continue; }
    if (argument === "--offline-smoke") { parsed.offlineSmoke = true; continue; }
    if (argument === "--live") { parsed.live = true; continue; }
    if (argument === "--approve-provider-data-review") { parsed.approvedProviderDataReview = true; continue; }
    if (argument === "--scenario" || singleValues.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} needs a value.`);
      index += 1;
      if (argument === "--scenario") {
        parsed.scenarioIds.push(value);
        continue;
      }
      if (seen.has(argument)) fail(`${argument} may be supplied once.`);
      seen.add(argument);
      if (argument === "--repetitions") parsed.repetitions = positiveInteger(argument, value);
      if (argument === "--artifacts") parsed.artifactRoot = value;
      if (argument === "--database-url") parsed.databaseUrl = value;
      if (argument === "--max-calls") parsed.maxCalls = positiveInteger(argument, value);
      if (argument === "--max-elapsed-ms") parsed.maxElapsedMs = positiveInteger(argument, value);
      if (argument === "--max-spend-usd") parsed.maxSpendUsd = positiveUsd(value);
      if (argument === "--provider-env-file") parsed.envFile = value;
      continue;
    }
    fail(`Unknown argument: ${argument}. Use --help for supported options.`);
  }
  if (new Set(parsed.scenarioIds).size !== parsed.scenarioIds.length) fail("Each --scenario ID may be supplied once.");
  return parsed;
}

function selectedScenarios(ids: string[]): Scenario[] {
  const selected = ids.length ? scenarios.filter((scenario) => ids.includes(scenario.id)) : scenarios;
  if (!selected.length || selected.length !== ids.length && ids.length) fail("No selected scenario exists.");
  return selected;
}

function controlledNoopBoundary() {
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage("Offline smoke transport. No Quote change was made.")]);
  const models = createModels();
  models.setProvider(provider.provider);
  return {
    model: provider.getModel(),
    timeoutMs: 1_000,
    streamFn: (model: Parameters<typeof models.streamSimple>[0], context: Parameters<typeof models.streamSimple>[1], options: Parameters<typeof models.streamSimple>[2]) => models.streamSimple(model, context, options),
  };
}

function assertOfflineSmoke(parsed: Arguments, selected: Scenario[]) {
  if (parsed.live) fail("--offline-smoke and --live cannot be used together.");
  if (parsed.approvedProviderDataReview || parsed.maxCalls !== undefined || parsed.maxElapsedMs !== undefined || parsed.maxSpendUsd !== undefined || parsed.envFile !== undefined) {
    fail("Provider approval, live limits, and --provider-env-file cannot be used with --offline-smoke.");
  }
  if (!parsed.databaseUrl) fail("--offline-smoke requires --database-url from npm run eval:db -- up. DATABASE_URL is never used.");
  if (selected.length !== 1 || !selected[0].id.endsWith("-full-reconstruction") || selected[0].provenance.kind !== "source-derived" || !selected[0].expectedQuote) {
    fail("--offline-smoke requires exactly one source-derived reconstruction scenario selected with --scenario.");
  }
}

function assertLive(parsed: Arguments, selected: Scenario[]) {
  if (!parsed.scenarioIds.length) fail("--live requires at least one explicit --scenario ID.");
  if (!parsed.approvedProviderDataReview) fail("--live requires --approve-provider-data-review. Local retention approval is not provider-data approval.");
  if (!parsed.databaseUrl) fail("--live requires --database-url from npm run eval:db -- up. DATABASE_URL is never used.");
  if (parsed.maxCalls === undefined || parsed.maxElapsedMs === undefined || parsed.maxSpendUsd === undefined) {
    fail("--live requires --max-calls, --max-elapsed-ms, and --max-spend-usd.");
  }
  if (parsed.maxCalls > 10_000) fail("--max-calls must not exceed 10000.");
  if (parsed.maxElapsedMs > 3_600_000) fail("--max-elapsed-ms must not exceed 3600000.");
  const controlledOnly = selected.filter((scenario) => scenario.execution === "controlled-only");
  if (controlledOnly.length) fail(`--live cannot run controlled-only scenarios: ${controlledOnly.map((scenario) => scenario.id).join(", ")}.`);
}

const liveEnvironmentNames = ["QUOTE_AI_PROVIDER", "QUOTE_AI_MODEL", "GEMINI_API_KEY", "QUOTE_AI_TIMEOUT_MS"] as const;

function liveEnvironment(envFile?: string): Record<string, string | undefined> {
  let fileValues: Record<string, string | undefined> = {};
  if (envFile) {
    try {
      const parsed = parseDotenv(readFileSync(envFile));
      fileValues = Object.fromEntries(liveEnvironmentNames.map((name) => [name, parsed[name]]));
    } catch {
      fail(`Could not read --provider-env-file ${envFile}.`);
    }
  }
  return Object.fromEntries(liveEnvironmentNames.map((name) => [name, process.env[name] === undefined ? fileValues[name] : process.env[name]]));
}

async function runOfflineSmoke(parsed: Arguments, scenario: Scenario) {
  for (let repetition = 1; repetition <= parsed.repetitions; repetition += 1) {
    const run = await runScenario(scenario, {
      databaseUrl: parsed.databaseUrl!,
      modelBoundary: controlledNoopBoundary(),
      repetition,
      modelSettings: { transport: "faux-controlled", mode: "offline-smoke", providerCalls: false, intentionallyNoop: true },
    });
    await saveRun(parsed.artifactRoot, run);
    console.info(`${scenario.id} repetition ${repetition}: ${run.automated}. Saved faux-controlled offline smoke evidence. Human review remains ${run.human}.`);
  }
}

async function runLive(parsed: Arguments, selected: Scenario[]) {
  assertLive(parsed, selected);
  const modelBoundary = configuredQuoteAI(liveEnvironment(parsed.envFile));
  const session = createLiveSession({
    modelBoundary,
    scenarios: selected,
    approvedProviderDataReview: true,
    maxCalls: parsed.maxCalls!,
    maxElapsedMs: parsed.maxElapsedMs!,
    maxSpendUsd: parsed.maxSpendUsd!,
    artifactRoot: parsed.artifactRoot,
  });
  console.info(`Live session ${session.id}: ${modelBoundary.model.provider}/${modelBoundary.model.id}. Selected ${selected.map(scenario => `${scenario.id}@v${scenario.version}`).join(", ")}.`);
  console.info(`Whole-command limits: ${parsed.maxCalls} calls, ${parsed.maxElapsedMs} ms, USD ${parsed.maxSpendUsd}. Conservative reservations are not actual charges.`);
  try {
    runs: for (let repetition = 1; repetition <= parsed.repetitions; repetition += 1) {
      for (const scenario of selected) {
        const run = await runScenario(scenario, {
          databaseUrl: parsed.databaseUrl!, modelBoundary, repetition, live: session,
        });
        await saveRun(parsed.artifactRoot, run);
        console.info(`${scenario.id} repetition ${repetition}: ${run.automated}, human review ${run.human}. Saved run ${run.id}.`);
        if (run.automated !== "passed") process.exitCode = 1;
        if (session.stopped) {
          console.error(`Live session ${session.id} stopped: ${session.stopped}`);
          process.exitCode = 1;
          break runs;
        }
      }
    }
  } finally {
    session.close();
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    if (process.argv.length !== 3) fail("--help cannot be combined with other arguments.");
    console.info(help);
    return;
  }
  const selected = selectedScenarios(parsed.scenarioIds);
  if (parsed.offlineSmoke) {
    assertOfflineSmoke(parsed, selected);
    await runOfflineSmoke(parsed, selected[0]);
    return;
  }
  if (parsed.live) {
    await runLive(parsed, selected);
    return;
  }
  if (parsed.approvedProviderDataReview || parsed.maxCalls !== undefined || parsed.maxElapsedMs !== undefined || parsed.maxSpendUsd !== undefined || parsed.databaseUrl || parsed.envFile !== undefined) {
    fail("Provider approval, live limits, --provider-env-file, and --database-url require --live or --offline-smoke.");
  }
  console.info(`Selected ${selected.length} scenario(s), ${parsed.repetitions} repetition(s). No provider call was made. Pass --offline-smoke for retained real-path evidence, or --live only after provider-data approval.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evaluation command failed.");
  process.exitCode = 2;
});
