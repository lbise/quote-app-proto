import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { QuoteData } from "../app/lib/quote";
import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { evaluateAssertions } from "./assertions";
import { openIsolatedEvaluationDatabase } from "./isolation";
import type { AssertionResult, EvaluationRun, Scenario, ScenarioStep, TurnResult } from "./types";

export type LiveEvaluationOptions = {
  approvedProviderDataReview: true;
  maxCalls: number;
  maxElapsedMs: number;
  /** No provider price schedule is tracked yet, so a monetary ceiling is refused. */
  maxSpendUsd?: number;
};

export type RunScenarioOptions = {
  /** URL for the local quote_evaluation template created by scripts/eval-db.sh. */
  databaseUrl: string;
  /** A test-controlled transport. Tools, prompts, HTTP and PostgreSQL stay real. */
  modelBoundary: QuoteAIModelBoundary;
  repetition?: number;
  modelSettings?: Record<string, unknown>;
  live?: LiveEvaluationOptions;
};

type QuoteDetail = { id: string; version: number; draft: QuoteData; pending: boolean; assistantDebug?: TurnResult["debug"]; diagnostic?: TurnResult["diagnostic"] };
type Handler = (request: Request) => Promise<Response>;

const origin = "http://evaluation.local";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function scenarioHash(scenario: Scenario): string {
  return createHash("sha256").update(stable(scenario)).digest("hex");
}

function git(command: string[]): string {
  try {
    return execFileSync("git", command, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

function promptToolsRevision(): string {
  const files = [
    "app/lib/quote-assistant.server.ts",
    "app/lib/quote-tools.server.ts",
    "app/lib/quote-ai-config.server.ts",
    "app/lib/quote.ts",
    "app/lib/quote-limits.ts",
    "docs/assistant-contract/edit-quote-lines.ts",
    "docs/assistant-contract/proposed-tools.json",
  ];
  try {
    const digest = createHash("sha256");
    for (const file of files) {
      digest.update(file);
      digest.update("\0");
      digest.update(readFileSync(resolve(process.cwd(), file)));
      digest.update("\0");
    }
    return digest.digest("hex");
  } catch {
    return "unknown";
  }
}

function revision() {
  return {
    application: git(["rev-parse", "HEAD"]),
    promptTools: promptToolsRevision(),
    dirty: git(["status", "--porcelain"]) !== "",
  };
}

function cloneQuote(quote: QuoteData): QuoteData {
  return structuredClone(quote);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /(authorization|credential|password|secret|token|api[-_]?key)/i.test(key) ? "[redacted]" : redact(item),
    ]));
  }
  return value;
}

function errorCode(payload: unknown): string | undefined {
  return payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : undefined;
}

function outcomeFor(status: number, payload: unknown): string {
  const code = errorCode(payload);
  if (code === "assistant_stale") return "stale";
  if (code === "assistant_unavailable") {
    const diagnostic = payload && typeof payload === "object" ? (payload as { details?: { diagnostic?: { outcome?: unknown } } }).details?.diagnostic : undefined;
    return typeof diagnostic?.outcome === "string" ? diagnostic.outcome : "discarded";
  }
  return code ?? `http_${status}`;
}

function recordedModelSettings(options: RunScenarioOptions): Record<string, unknown> {
  return {
    ...(redact(options.modelSettings ?? { transport: "controlled" }) as Record<string, unknown>),
    generation: {
      maxTokens: 4096,
      maxRetries: 0,
      cacheRetention: "none",
      thinkingLevel: "off",
      timeoutMs: options.modelBoundary.timeoutMs,
    },
  };
}

function invalidRun(scenario: Scenario, options: RunScenarioOptions, reason: string): EvaluationRun {
  const startedAt = new Date().toISOString();
  return {
    format: "quote-evaluation/v1",
    id: randomUUID(),
    scenario,
    scenarioHash: scenarioHash(scenario),
    startedAt,
    revision: revision(),
    model: { provider: options.modelBoundary.model.provider, id: options.modelBoundary.model.id ?? "unknown", settings: recordedModelSettings(options) },
    repetition: options.repetition ?? 1,
    elapsedMs: 0,
    usage: null,
    cost: { estimatedUsd: null, assumptions: "No usage or provider price schedule was captured.", ceilingEnforceable: false },
    modelCalls: 0,
    turns: [{ step: 0, kind: "manual", input: "", before: cloneQuote(scenario.startingQuote), after: cloneQuote(scenario.startingQuote), message: "", outcome: "invalid", failedCalls: 0, elapsedMs: 0, assertions: [{ label: reason, path: "", passed: false, expected: "scenario expectations", actual: "missing" }] }],
    automated: "invalid",
    human: "pending",
  };
}

function missingExpectations(scenario: Scenario): string | undefined {
  for (const [index, step] of scenario.steps.entries()) {
    if (!step.assertions.length) return `Scenario step ${index + 1} has no deterministic expectations`;
    if (step.assertions.some((assertion) => assertion.operator !== "unchanged" && assertion.expected === undefined)) {
      return `Scenario step ${index + 1} has an assertion without an expected value`;
    }
  }
  return undefined;
}

function assertionsFor(step: ScenarioStep, before: QuoteData, after: QuoteData, outcome: string, failedCalls: number): AssertionResult[] {
  return evaluateAssertions(step.assertions, before, after, outcome, failedCalls);
}

function expectsTerminalOutcome(step: ScenarioStep, outcome: string): boolean {
  return step.assertions.some((assertion) => assertion.path === "outcome" && assertion.operator === "equals" && assertion.expected === outcome);
}

type CapturedUsage = { input: number; output: number };

function usageFrom(value: unknown): CapturedUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const { input, output } = usage as { input?: unknown; output?: unknown };
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    && typeof output === "number" && Number.isFinite(output) && output >= 0
    ? { input, output }
    : undefined;
}

async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return undefined; }
}

function request(handler: Handler, body?: Record<string, unknown>, id?: string): Promise<Response> {
  return handler(new Request(`${origin}/api/quotes${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
    method: body ? "POST" : "GET",
    headers: body ? { origin, "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }));
}

async function detail(handler: Handler, id: string): Promise<QuoteDetail> {
  const response = await request(handler, undefined, id);
  if (!response.ok) throw new Error(`Could not read evaluation Quote (${response.status}).`);
  return await json(response) as QuoteDetail;
}

async function seed(handler: Handler, startingQuote: QuoteData): Promise<QuoteDetail> {
  const created = await request(handler, { action: "create", requestId: `eval-create-${randomUUID()}` });
  if (!created.ok) throw new Error(`Could not create evaluation Quote (${created.status}).`);
  const record = await json(created) as QuoteDetail;
  const saved = await request(handler, {
    action: "save", id: record.id, expectedVersion: record.version,
    requestId: `eval-seed-${randomUUID()}`, quote: startingQuote,
  });
  if (!saved.ok) throw new Error(`Could not seed evaluation Quote (${saved.status}).`);
  return await json(saved) as QuoteDetail;
}

/**
 * Runs one scenario through createQuoteHandler. A stream function is the only
 * replaceable piece. The Agent, registered tools, HTTP handler and database
 * commit path are all production code.
 */
export async function runScenario(scenario: Scenario, options: RunScenarioOptions): Promise<EvaluationRun> {
  if (!options.live && options.modelBoundary.model.provider !== "faux") {
    throw new Error("A non-faux provider requires explicit live opt-in and provider-data approval.");
  }
  if (options.live) {
    if (scenario.execution === "controlled-only") throw new Error("Fault-injection scenarios require a controlled model transport, not live interpretation.");
    if (!options.live.approvedProviderDataReview || scenario.review.provider !== "approved") {
      throw new Error("Live evaluation is blocked: this scenario has no approved provider-data review.");
    }
    if (!Number.isInteger(options.live.maxCalls) || options.live.maxCalls < 1 || !Number.isInteger(options.live.maxElapsedMs) || options.live.maxElapsedMs < 1) {
      throw new Error("Live evaluation requires positive maxCalls and maxElapsedMs limits.");
    }
    throw new Error("Live evaluation is disabled: provider usage and pricing are not captured reliably enough to enforce a monetary ceiling.");
  }
  if (scenario.history.length) return invalidRun(scenario, options, "Scenario history cannot be seeded through the real HTTP path");
  if (!scenario.steps.length) return invalidRun(scenario, options, "Scenario has no executable steps");
  const missingExpectation = missingExpectations(scenario);
  if (missingExpectation) return invalidRun(scenario, options, missingExpectation);

  const started = Date.now();
  const startedAt = new Date().toISOString();
  const isolated = await openIsolatedEvaluationDatabase(options.databaseUrl);
  try {
    const [{ createQuoteHandler }, { artisan, artisanBusiness, user }] = await Promise.all([
      import("../app/lib/quotes.server"),
      import("../app/lib/db/schema"),
    ]);
    const userId = `evaluation-user-${randomUUID()}`;
    const businessId = `evaluation-business-${randomUUID()}`;
    await isolated.database.insert(user).values({ id: userId, name: "Evaluation Artisan", email: `${userId}@example.test`, emailVerified: true });
    await isolated.database.insert(artisanBusiness).values({ id: businessId, ownerUserId: userId });
    await isolated.database.insert(artisan).values({ id: `evaluation-artisan-${randomUUID()}`, userId, businessId, interfaceLanguage: scenario.locale });
    const auth = { api: { getSession: async () => ({ user: { id: userId, email: `${userId}@example.test`, emailVerified: true } }) } };
    let modelCalls = 0;
    const usage: CapturedUsage = { input: 0, output: 0 };
    let usageReports = 0;
    const observedBoundary: QuoteAIModelBoundary = {
      ...options.modelBoundary,
      streamFn: async (model, context, streamOptions) => {
        modelCalls += 1;
        const stream = await options.modelBoundary.streamFn(model, context, streamOptions);
        void stream.result().then((message) => {
          const reported = usageFrom(message);
          if (!reported) return;
          usage.input += reported.input;
          usage.output += reported.output;
          usageReports += 1;
        }).catch(() => {
          // The handler records provider failures. Usage observation must not
          // extend its timeout or turn into a second transport failure.
        });
        return stream;
      },
    };
    const handler = createQuoteHandler({ database: isolated.database, auth, modelBoundary: observedBoundary });
    let current = await seed(handler, cloneQuote(scenario.startingQuote));
    const turns: TurnResult[] = [];

    for (const [index, step] of scenario.steps.entries()) {
      const before = cloneQuote(current.draft);
      const turnStarted = Date.now();
      let response: Response | undefined;
      let payload: unknown;
      let concurrentSaveError: string | undefined;
      let manualSaved = false;

      if (step.kind === "manual") {
        response = await request(handler, {
          action: "save", id: current.id, expectedVersion: current.version,
          requestId: `eval-manual-${randomUUID()}`, quote: step.quote,
        });
        payload = await json(response);
      } else {
        const streamBoundary: QuoteAIModelBoundary = step.concurrentManualQuote
          ? {
            ...observedBoundary,
            streamFn: async (model, context, streamOptions) => {
              if (!manualSaved) {
                manualSaved = true;
                const saved = await request(handler, {
                  action: "save", id: current.id, expectedVersion: current.version,
                  requestId: `eval-concurrent-manual-${randomUUID()}`, quote: step.concurrentManualQuote,
                });
                if (!saved.ok) concurrentSaveError = `Concurrent manual save failed (${saved.status}).`;
              }
              return observedBoundary.streamFn(model, context, streamOptions);
            },
          }
          : observedBoundary;
        const turnHandler = streamBoundary === observedBoundary
          ? handler
          : createQuoteHandler({ database: isolated.database, auth, modelBoundary: streamBoundary });
        response = await request(turnHandler, {
          action: "assistant", id: current.id, expectedVersion: current.version,
          requestId: `eval-assistant-${randomUUID()}`, text: step.text, locale: scenario.locale,
        });
        payload = await json(response);
      }

      current = await detail(handler, current.id);
      const after = cloneQuote(current.draft);
      const diagnostic = payload && typeof payload === "object"
        ? (payload as { details?: { diagnostic?: TurnResult["diagnostic"] } }).details?.diagnostic
        : undefined;
      const debug = payload && typeof payload === "object"
        ? (payload as { assistantDebug?: TurnResult["debug"]; details?: { assistantDebug?: TurnResult["debug"] } }).assistantDebug
          ?? (payload as { details?: { assistantDebug?: TurnResult["debug"] } }).details?.assistantDebug
        : undefined;
      const safeDebug = debug ? redact(debug) as TurnResult["debug"] : undefined;
      const safeDiagnostic = diagnostic ? redact(diagnostic) as TurnResult["diagnostic"] : undefined;
      const failedCalls = safeDebug?.failedCalls ?? safeDiagnostic?.failedCalls ?? 0;
      const outcome = response.ok
        ? safeDebug?.outcome ?? (step.kind === "manual" ? "manual_saved" : "unchanged")
        : outcomeFor(response.status, payload);
      const message = response.ok && payload && typeof payload === "object"
        ? ((payload as { messages?: { en?: string }[] }).messages?.at(-1)?.en ?? "")
        : "";
      const assertions = assertionsFor(step, before, after, outcome, failedCalls);
      if (!response.ok && !expectsTerminalOutcome(step, outcome)) {
        assertions.push({ label: "Terminal HTTP outcome is explicitly expected", path: "outcome", passed: false, expected: "an equals assertion for the terminal outcome", actual: outcome });
      }
      if (concurrentSaveError) assertions.push({ label: "Concurrent manual save completed", path: "", passed: false, expected: "saved", actual: concurrentSaveError });
      turns.push({
        step: index,
        kind: step.kind,
        input: step.kind === "artisan" ? step.text : step.note,
        before,
        after,
        message,
        outcome,
        failedCalls,
        elapsedMs: Date.now() - turnStarted,
        assertions,
        ...(safeDebug ? { debug: safeDebug } : {}),
        ...(safeDiagnostic ? { diagnostic: safeDiagnostic } : {}),
        ...(!response.ok ? { error: errorCode(payload) ?? `HTTP ${response.status}` } : {}),
      });
    }

    const allPassed = turns.every((turn) => turn.assertions.every((assertion) => assertion.passed));
    return {
      format: "quote-evaluation/v1",
      id: randomUUID(),
      scenario,
      scenarioHash: scenarioHash(scenario),
      startedAt,
      revision: revision(),
      model: { provider: options.modelBoundary.model.provider, id: options.modelBoundary.model.id ?? "unknown", settings: recordedModelSettings(options) },
      repetition: options.repetition ?? 1,
      elapsedMs: Date.now() - started,
      usage: usageReports ? { input: usage.input, output: usage.output, total: usage.input + usage.output } : null,
      cost: { estimatedUsd: null, assumptions: usageReports ? `Usage was reported by ${usageReports} of ${modelCalls} model calls; no provider price schedule is configured.` : "No model call reported token usage or a provider price schedule.", ceilingEnforceable: false },
      modelCalls,
      turns,
      automated: allPassed ? "passed" : "failed",
      human: "pending",
    };
  } finally {
    await isolated.close();
  }
}
