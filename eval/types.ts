import type { QuoteData, QuoteProblem } from "../app/lib/quote";
import type { QuoteAssistantDiagnostic, QuoteAssistantSuccessDebug } from "../app/lib/quote-assistant-debug";

export type Assertion = {
  label: string;
  /** Dot path into {quote, calculation, outcome, failedCalls}. IDs are excluded from quote; sectionId becomes section index. */
  path: string;
  operator: "equals" | "contains" | "unchanged";
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
  id: string;
  version: number;
  /** Fault-injection scenarios are not live interpretation benchmarks. */
  execution?: "controlled-only";
  title: string;
  profession: "joinery" | "landscape" | "civil-works";
  provenance: { kind: "source-derived" | "synthetic-edge"; alias: string; notes: string[] };
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
export type AssertionResult = { label: string; path: string; passed: boolean; expected: unknown; actual: unknown };
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
export type EvaluationRun = {
  format: "quote-evaluation/v1";
  id: string;
  scenario: Scenario;
  scenarioHash: string;
  startedAt: string;
  revision: { application: string; promptTools: string; dirty: boolean };
  model: { provider: string; id: string; settings: Record<string, unknown> };
  repetition: number;
  elapsedMs: number;
  usage: { input: number; output: number; total: number } | null;
  cost: { estimatedUsd: number | null; assumptions: string; ceilingEnforceable: boolean };
  modelCalls: number;
  turns: TurnResult[];
  automated: "passed" | "failed" | "invalid";
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
