import { readFileSync } from "node:fs";

import { parse as parseDotenv } from "dotenv";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

import { configuredQuoteAI } from "../app/lib/quote-ai-config.server";
import { selectEvaluationScenarios, startEvaluation } from "../eval/execution";
import { createLiveSession } from "../eval/live";
import type { Scenario } from "../eval/types";

const help = `Usage: npm run eval:run -- [options]

  --scenario ID                 Select one scenario. Repeat for several scenarios.
  --suite contract|scenario     Select the contract checks or scenario cases.
  --repetitions N               Run each selected scenario N times. Default: 1.
  --artifacts PATH              Local artifact directory. Default: .eval-artifacts.
  --offline-smoke               Run one source-derived reconstruction with a controlled faux no-op reply.
  --database-url URL            Dedicated URL printed by npm run eval:db -- up.
  --live                        Request a live provider evaluation.
  --approve-provider-data-review Required with --live.
  --max-calls N                 Required with --live.
  --max-elapsed-ms N            Required with --live.
  --max-spend-usd USD           Required with --live; at most 1000000 with up to 9 decimal places.
  --reasoning LEVEL             Google: minimal|low|medium|high (Off is unsupported).
  --max-output-tokens N         Advanced output and reasoning token limit per call (at most 4096).
  --provider-env-file PATH      Read only provider variables from PATH, after live approval.
  --help                        Show this help.

Offline smoke uses createQuoteHandler, the registered tools, and a fresh PostgreSQL case database. It saves a faux-controlled artifact and intentionally fails reconstruction assertions. It never calls a provider.

Live evaluation requires an explicit --scenario or --suite selection, runtime provider-data approval, a dedicated database, and bounded calls, elapsed time, and spend. It supports only the registered Google gemini-3.5-flash-lite boundary; other provider/model selections fail closed.`;

type Suite = "contract" | "scenario";

type Arguments = {
  scenarioIds: string[];
  suite?: Suite;
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
  reasoning?: string;
  maxOutputTokens?: number;
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
  const singleValues = new Set(["--suite", "--repetitions", "--artifacts", "--database-url", "--max-calls", "--max-elapsed-ms", "--max-spend-usd", "--provider-env-file", "--reasoning", "--max-output-tokens"]);
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
      if (argument === "--suite") {
        if (value !== "contract" && value !== "scenario") fail("--suite must be contract or scenario.");
        parsed.suite = value;
      }
      if (argument === "--repetitions") parsed.repetitions = positiveInteger(argument, value);
      if (argument === "--artifacts") parsed.artifactRoot = value;
      if (argument === "--database-url") parsed.databaseUrl = value;
      if (argument === "--max-calls") parsed.maxCalls = positiveInteger(argument, value);
      if (argument === "--max-elapsed-ms") parsed.maxElapsedMs = positiveInteger(argument, value);
      if (argument === "--max-spend-usd") parsed.maxSpendUsd = positiveUsd(value);
      if (argument === "--provider-env-file") parsed.envFile = value;
      if (argument === "--reasoning") parsed.reasoning = value;
      if (argument === "--max-output-tokens") parsed.maxOutputTokens = positiveInteger(argument, value);
      continue;
    }
    fail(`Unknown argument: ${argument}. Use --help for supported options.`);
  }
  if (new Set(parsed.scenarioIds).size !== parsed.scenarioIds.length) fail("Each --scenario ID may be supplied once.");
  return parsed;
}

function scenarioSuite(scenario: Scenario): Suite {
  return scenario.suite === "contract" ? "contract" : "scenario";
}

function runOutcome(run: { automated: string; checks?: unknown }): string {
  const checks = run.checks;
  if (checks && typeof checks === "object" && "contract" in checks && "commercial" in checks
    && ["passed", "failed", "invalid"].includes(String(checks.contract))
    && ["passed", "failed", "invalid"].includes(String(checks.commercial))) {
    return `contract ${checks.contract}; commercial ${checks.commercial}`;
  }
  return `automated ${run.automated}`;
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
  if (parsed.approvedProviderDataReview || parsed.maxCalls !== undefined || parsed.maxElapsedMs !== undefined || parsed.maxSpendUsd !== undefined || parsed.envFile !== undefined || parsed.reasoning !== undefined || parsed.maxOutputTokens !== undefined) {
    fail("Provider approval, live limits, and --provider-env-file cannot be used with --offline-smoke.");
  }
  if (!parsed.databaseUrl) fail("--offline-smoke requires --database-url from npm run eval:db -- up. DATABASE_URL is never used.");
  if (selected.length !== 1 || !selected[0].id.endsWith("-full-reconstruction") || selected[0].provenance.kind !== "source-derived" || !selected[0].expectedQuote) {
    fail("--offline-smoke requires exactly one source-derived reconstruction scenario selected with --scenario.");
  }
}

function assertLive(parsed: Arguments, selected: Scenario[]) {
  if (!parsed.scenarioIds.length && !parsed.suite) fail("--live requires at least one explicit --scenario ID or --suite.");
  if (!parsed.approvedProviderDataReview) fail("--live requires --approve-provider-data-review. Local retention approval is not provider-data approval.");
  if (!parsed.databaseUrl) fail("--live requires --database-url from npm run eval:db -- up. DATABASE_URL is never used.");
  if (parsed.maxCalls === undefined || parsed.maxElapsedMs === undefined || parsed.maxSpendUsd === undefined) {
    fail("--live requires --max-calls, --max-elapsed-ms, and --max-spend-usd.");
  }
  if (parsed.maxCalls > 10_000) fail("--max-calls must not exceed 10000.");
  if (parsed.maxElapsedMs > 3_600_000) fail("--max-elapsed-ms must not exceed 3600000.");
  if (parsed.reasoning !== undefined && !["minimal", "low", "medium", "high"].includes(parsed.reasoning)) fail("--reasoning must be minimal, low, medium or high for this Google model; off is unsupported.");
  if (parsed.maxOutputTokens !== undefined && parsed.maxOutputTokens > 4096) fail("--max-output-tokens must not exceed 4096 for this price bound.");
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
  const execution = startEvaluation({ artifactRoot: parsed.artifactRoot, databaseUrl: parsed.databaseUrl!, scenarios: [scenario], repetitions: parsed.repetitions,
    boundary: controlledNoopBoundary(), mode: "offline-smoke", settings: { requested: { transport: "faux-controlled" }, effective: { providerCalls: false, intentionallyNoop: true } },
    limits: null, pricing: null,
    onRun: (id, item, repetition, automated) => console.info(`${item.id} repetition ${repetition}: ${automated}. Saved faux-controlled offline smoke evidence ${id}. Human review remains pending.`),
  });
  console.info(`Offline smoke session ${execution.id}.`);
  await execution.completion;
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
    generation: { ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}), ...(parsed.maxOutputTokens ? { maxOutputTokens: parsed.maxOutputTokens } : {}) },
  });
  let execution: ReturnType<typeof startEvaluation>;
  try { execution = startEvaluation({ artifactRoot: parsed.artifactRoot, databaseUrl: parsed.databaseUrl!, scenarios: selected, repetitions: parsed.repetitions,
    boundary: modelBoundary, mode: "live", live: session, limits: session.limits,
    pricing: { ...session.pricing, units: "nanodollars per token", assumptions: "Highest published text rate; full context plus configured output reserved before each request, never refunded." },
    settings: { requested: { reasoning: parsed.reasoning ?? "unknown", maxOutputTokens: parsed.maxOutputTokens ?? 4096 }, effective: session.effectiveGeneration },
    onRun: (id, scenario, repetition, automated) => {
      console.info(`${scenario.id} [${scenarioSuite(scenario)}] repetition ${repetition}: automated ${automated}, human review pending. Saved run ${id}.`);
      if (automated !== "passed") process.exitCode = 1;
    },
  }); } catch (error) { session.close(); throw error; }
  console.info(`Live session ${execution.id}: ${modelBoundary.model.provider}/${modelBoundary.model.id}. Selected ${selected.map(scenario => `${scenario.id}@v${scenario.version} [${scenarioSuite(scenario)}]`).join(", ")}.`);
  console.info(`Whole-command limits: ${parsed.maxCalls} calls, ${parsed.maxElapsedMs} ms, USD ${parsed.maxSpendUsd}. Conservative reservations are not actual charges.`);
  await execution.completion;
  if (session.stopped) { console.error(`Live session ${session.id} stopped: ${session.stopped}`); process.exitCode = 1; }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    if (process.argv.length !== 3) fail("--help cannot be combined with other arguments.");
    console.info(help);
    return;
  }
  if (parsed.live && !parsed.scenarioIds.length && !parsed.suite) fail("--live requires at least one explicit --scenario ID or --suite.");
  const selected = selectEvaluationScenarios(parsed.scenarioIds, parsed.suite);
  if (parsed.offlineSmoke) {
    assertOfflineSmoke(parsed, selected);
    await runOfflineSmoke(parsed, selected[0]);
    return;
  }
  if (parsed.live) {
    await runLive(parsed, selected);
    return;
  }
  if (parsed.approvedProviderDataReview || parsed.maxCalls !== undefined || parsed.maxElapsedMs !== undefined || parsed.maxSpendUsd !== undefined || parsed.databaseUrl || parsed.envFile !== undefined || parsed.reasoning !== undefined || parsed.maxOutputTokens !== undefined) {
    fail("Provider approval, live limits, --provider-env-file, and --database-url require --live or --offline-smoke.");
  }
  console.info(`Selected ${selected.length} case(s), ${parsed.repetitions} repetition(s): ${selected.map(scenario => `${scenario.id} [${scenarioSuite(scenario)}]`).join(", ")}. No provider call was made. Pass --offline-smoke for retained real-path evidence, or --live only after provider-data approval.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evaluation command failed.");
  process.exitCode = 2;
});
