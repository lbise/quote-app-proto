import type { QuoteData, QuoteProblem } from "../app/lib/quote";
import type { QuoteAssistantDiagnostic, QuoteAssistantSuccessDebug } from "../app/lib/quote-assistant-debug";

export type Assertion = {
  /** Untagged assertions check commercial state, preserving existing scenario hashes. */
  category?: "contract" | "commercial";
  label: string;
  /** Dot path into {quote, calculation, outcome, failedCalls, message}. IDs are excluded from quote; sectionId becomes section index. */
  path: string;
  operator: "equals" | "contains" | "oneOf" | "unchanged";
  expected?: unknown;
};
export type ScenarioStep = {
  kind: "artisan";
  text: string;
  /** Scripted manual save during the model call, for stale-turn evaluation. */
  concurrentManualQuote?: QuoteData;
  assertions: Assertion[];
} | {
  kind: "manual";
  note: string;
  quote: QuoteData;
  assertions: Assertion[];
};
export type ExpectedCalculation = {
  lines: { amount: number | null }[];
  sections: { subtotal: number; incomplete: boolean }[];
  subtotal: number;
  discount: number | null;
  net: number | null;
  vat: number | null;
  total: number | null;
  complete: boolean;
  missing: QuoteProblem[];
  errors: QuoteProblem[];
};
export type Scenario = {
  /** Existing artifacts without a suite belong to the scenario suite. */
  suite?: "contract" | "scenario";
  id: string;
  version: number;
  /** Fault-injection scenarios are not live interpretation benchmarks. */
  execution?: "controlled-only";
  title: string;
  profession: "joinery" | "landscape" | "civil-works";
  provenance: { kind: "source-derived" | "synthetic-edge" | "synthetic-contract"; alias: string; notes: string[] };
  review: { inputs: "pending" | "approved"; expectations: "pending" | "approved"; provider: "blocked" | "approved"; note: string };
  locale: "fr" | "en";
  startingQuote: QuoteData;
  /** Only this history is permitted model context. Expectations and provenance are never sent. */
  history: { role: "artisan" | "assistant" | "note"; fr: string; en: string }[];
  steps: ScenarioStep[];
  expectedQuote?: QuoteData;
  /** Independently worked final amounts and incompleteness, never production-calculated. */
  expectedCalculation?: ExpectedCalculation;
  requiredClarification: string[];
  forbiddenMutations: string[];
  humanReview: string[];
};
export type AssertionResult = { category?: Assertion["category"]; label: string; path: string; passed: boolean; expected: unknown; actual: unknown };
export type TurnResult = {
  step: number;
  kind: "artisan" | "manual";
  input: string;
  before: QuoteData;
  after: QuoteData;
  message: string;
  outcome: string;
  failedCalls: number;
  elapsedMs: number;
  assertions: AssertionResult[];
  debug?: QuoteAssistantSuccessDebug;
  diagnostic?: QuoteAssistantDiagnostic;
  error?: string;
};
export type LiveCall = {
  number: number;
  reservedUsd: number;
  status: "reserved" | "complete" | "uncertain";
  estimatedUsd: number | null;
  /** Bounded terminal reason emitted by the SDK. */
  stopReason?: string;
  /** Bounded provider-native terminal reason, when supplied by the SDK. */
  rawStopReason?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite?: number; reasoning?: number };
  routedModel?: string;
  routedProvider?: string;
  responseId?: string;
  reportedCostUsd?: number;
  httpStatus?: number;
  providerErrorCategory?: "unsupported_parameter" | "no_compatible_endpoint" | "invalid_request" | "invalid_prompt" | "context_length_exceeded" | "string_too_long";
  providerErrorField?: string;
};
export type LiveEvidence = {
  sessionId: string;
  approvedScenarioHashes: string[];
  approval: { at: string; scenarioHash: string; provider: string; model: string; method: "explicit-launch" };
  limits: { maxCalls: number; callsPerRun?: number; maxElapsedMs: number; maxSpendUsd: number };
  pricing: { id: string; checkedAt: string; expiresAt: string; source: string; inputNanoUsd: number; outputNanoUsd: number; maxInputTokens: number; maxOutputTokens: number;
    units?: string; routing?: string; endpoints?: unknown[]; cacheReadNanoUsd?: number; cacheWriteNanoUsd?: number; requestNanoUsd?: number; reasoningNanoUsd?: number };
  calls: LiveCall[];
  sessionCalls: number;
  sessionReservedUsd: number;
  stopReason?: string;
};
export type EvaluationSessionPlan = {
  format: "quote-evaluation-session/v1";
  id: string;
  createdAt: string;
  mode: "live" | "offline-smoke";
  /** Durable browser idempotency key and canonical settings digest. */
  browserRequest?: { id: string; fingerprint: string };
  selection: { scenarioIds: string[]; repetitions: number };
  model: { provider: string; id: string; requested: Record<string, unknown>; effective: Record<string, unknown> };
  launchAuthorization: { method: "explicit-cli-launch" | "browser-start"; at: string; scenarioHashes: string[] };
  limits: { maxCalls: number; callsPerRun?: number; maxElapsedMs: number; maxSpendUsd: number } | null;
  pricing: (LiveEvidence["pricing"] & { units: string; assumptions: string }) | null;
  work: { id: string; scenarioId: string; scenarioHash: string; repetition: number }[];
};
export type EvaluationSessionState = {
  status: "starting" | "running" | "completed" | "failed-to-start" | "stopped" | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  reason?: string;
  activeWorkId?: string;
  work: { id: string; status: "missing" | "running" | "completed" | "interrupted" | "skipped"; runId?: string }[];
  calls: number;
  reservedUsd: number;
};
export type EvaluationSessionRecord = { plan: EvaluationSessionPlan; state: EvaluationSessionState };
export type EvaluationRun = {
  format: "quote-evaluation/v1";
  id: string;
  /** Older runs predate durable sessions. */
  sessionId?: string;
  scenario: Scenario;
  scenarioHash: string;
  startedAt: string;
  revision: { application: string; promptTools: string; dirty: boolean };
  model: { provider: string; id: string; settings: Record<string, unknown> };
  repetition: number;
  elapsedMs: number;
  usage: { input: number; output: number; total: number } | null;
  cost: { estimatedUsd: number | null; assumptions: string; ceilingEnforceable: boolean; reservedUsd?: number };
  live?: LiveEvidence;
  modelCalls: number;
  turns: TurnResult[];
  automated: "passed" | "failed" | "invalid";
  /** Separate signals for contract checks; absent on older and scenario-suite runs. */
  checks?: { contract: "passed" | "failed" | "invalid"; commercial: "passed" | "failed" | "invalid" };
  human: "pending";
};
export type HumanReview = {
  format: "quote-evaluation-review/v1";
  id: string;
  runId: string;
  scenarioHash: string;
  createdAt: string;
  reviewer: string;
  wording: "pass" | "fail" | "pending";
  inventedFacts: "pass" | "fail" | "pending";
  clarification: "pass" | "fail" | "pending";
  notes: string;
};
