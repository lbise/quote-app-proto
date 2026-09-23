import { expect, it } from "vitest";
import { emptyQuote } from "../app/lib/quote";
import { renderReport } from "./report";
import type { EvaluationRun, HumanReview, Scenario } from "./types";
const scenario: Scenario = {
  id: "joinery-review", version: 1, title: "Joinery <script>alert(1)</script>", profession: "joinery",
  provenance: { kind: "source-derived", alias: "joinery-cladding-reference", notes: ["Adapted units are explicit in the Artisan input."] },
  review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "Local review only" },
  locale: "fr", startingQuote: emptyQuote("EVAL-1"), history: [],
  steps: [{ kind: "artisan", text: "Ajoute la dépose.", assertions: [{ label: "One work line", path: "quote.lines.length", operator: "equals", expected: 1 }] }],
  requiredClarification: ["Ask for the missing amount."], forbiddenMutations: ["No invented price"], humanReview: ["French wording"],
};
it("lets a reviewer inspect a source-derived scenario without any run or provider call", () => {
  const html = renderReport({ scenarios: [scenario], runs: [], scenarioId: scenario.id, reviews: [] });
  expect(html).toContain("joinery-cladding-reference");
  expect(html).toContain("Starting Working Draft");
  expect(html).toContain("Ajoute la dépose.");
  expect(html).toContain("quote.lines.length");
  expect(html).toContain("No provider calls");
  expect(html).toContain("Provider use: blocked");
  expect(html).not.toContain("<script>alert(1)</script>");
});
it("keeps automatic success separate from human approval and displays failed assertions", () => {
  const run: EvaluationRun = {
    format: "quote-evaluation/v1", id: "run-render", scenarioHash: "b".repeat(64), scenario, startedAt: "2026-09-01T00:00:00Z",
    revision: { application: "test", promptTools: "test", dirty: false }, model: { provider: "faux", id: "controlled", settings: {} },
    repetition: 1, elapsedMs: 1, usage: null, cost: { estimatedUsd: null, assumptions: "Offline", ceilingEnforceable: false }, modelCalls: 1,
    automated: "failed", human: "pending", turns: [{ step: 0, kind: "artisan", input: "Ajoute la dépose.", before: scenario.startingQuote, after: scenario.startingQuote, message: "Fait.", outcome: "unchanged", failedCalls: 0, elapsedMs: 1, assertions: [{ label: "One work line", path: "quote.lines.length", expected: 1, actual: undefined, passed: false }] }],
  };
  const html = renderReport({ scenarios: [scenario], runs: [run], runId: run.id, reviews: [] });
  expect(html).toContain("Human review: <strong>pending</strong>");
  expect(html).not.toContain("Contract checks: <strong>");
  expect(html).toContain("FAIL</strong> One work line");
  expect(html).toContain("Assertions: 0 passed, 1 failed");
  expect(html).toContain('href="#human-review"');
  expect(html).toContain("[missing]");
  expect(html).toContain("Save a new review");
  expect(html).toContain("Expected / actual final Quote");
  const live: EvaluationRun = { ...run, model: { provider: "google", id: "gemini-3.5-flash-lite", settings: {} },
    cost: { estimatedUsd: null, reservedUsd: 0.58466304, ceilingEnforceable: true, assumptions: "Recorded rates, not an invoice guarantee." },
    live: { sessionId: "bounded-session", approvedScenarioHashes: [run.scenarioHash], approval: { at: run.startedAt, scenarioHash: run.scenarioHash, provider: "google", model: "gemini-3.5-flash-lite", method: "explicit-launch" },
      limits: { maxCalls: 8, maxElapsedMs: 120000, maxSpendUsd: 5 },
      pricing: { id: "test-prices", checkedAt: "2026-09-22", expiresAt: "2026-09-29T00:00:00Z", source: "https://ai.google.dev", inputNanoUsd: 540, outputNanoUsd: 4500, maxInputTokens: 1048576, maxOutputTokens: 4096 },
      calls: [
        { number: 1, reservedUsd: 0.58466304, status: "complete", estimatedUsd: 0.0004896, usage: { input: 120, output: 80, cacheRead: 20 }, stopReason: "length", rawStopReason: "MAX_TOKENS" },
        { number: 2, reservedUsd: 0.58466304, status: "uncertain", estimatedUsd: null },
      ], sessionCalls: 2, sessionReservedUsd: 1.16932608, stopReason: "usage_unavailable" },
  };
  const liveHtml = renderReport({ scenarios: [scenario], runs: [live], runId: live.id, reviews: [] });
  expect(liveHtml).toContain("Provider transmission authorized at launch for the selected scenarios in this invocation");
  expect(liveHtml).toContain("usage_unavailable");
  expect(liveHtml).toContain("0.58466304");
  expect(liveHtml).toContain("No reliable complete usage estimate");
  expect(liveHtml).toContain("Call 1");
  expect(liveHtml).toContain("SDK stop reason: length");
  expect(liveHtml).toContain("Provider finish reason: MAX_TOKENS");
  expect(liveHtml).toContain("Call 2");
  expect(liveHtml).toContain("SDK stop reason: not recorded");
  const rejected: EvaluationRun = { ...live, live: { ...live.live!, calls: [
    { ...live.live!.calls[1], httpStatus: 400, providerErrorCategory: "unsupported_parameter", providerErrorField: "store" },
  ] } };
  const rejectedHtml = renderReport({ scenarios: [scenario], runs: [rejected], runId: rejected.id, reviews: [] });
  expect(rejectedHtml).toContain("HTTP 400");
  expect(rejectedHtml).toContain("unsupported_parameter: store");
  expect(rejectedHtml).not.toContain("do-not-save");
  expect(liveHtml).toContain("Human review: <strong>pending</strong>");
  const review: HumanReview = { format: "quote-evaluation-review/v1", id: "review-1", runId: run.id, scenarioHash: run.scenarioHash, createdAt: run.startedAt, reviewer: "Maintainer", wording: "pass", inventedFacts: "pass", clarification: "pending", notes: "Still checking" };
  expect(renderReport({ scenarios: [scenario], runs: [run], runId: run.id, reviews: [review] })).toContain("Human review: <strong>pending</strong>");
});
it("separates fictional contract outcomes from commercial outcomes without changing legacy runs", () => {
  const contractScenario: Scenario = { ...scenario, id: "contract-fixed-line", title: "Fixed <contract>", suite: "contract" };
  const contractRun: EvaluationRun = {
    format: "quote-evaluation/v1", id: "contract-run", scenarioHash: "c".repeat(64), scenario: contractScenario, startedAt: "2026-09-01T00:00:00Z",
    revision: { application: "test", promptTools: "test", dirty: false }, model: { provider: "faux", id: "controlled", settings: {} },
    repetition: 1, elapsedMs: 1, usage: null, cost: { estimatedUsd: null, assumptions: "Offline", ceilingEnforceable: false }, modelCalls: 1,
    automated: "failed", human: "pending", checks: { contract: "failed", commercial: "passed" },
    turns: [{ step: 0, kind: "artisan", input: "Add fixed line", before: contractScenario.startingQuote, after: contractScenario.startingQuote, message: "", outcome: "unchanged", failedCalls: 0, elapsedMs: 1, assertions: [{ label: "fixed line", path: "quote.lines.length", expected: 1, actual: 0, passed: false, category: "contract" }] }],
  };

  const html = renderReport({ scenarios: [contractScenario, scenario], runs: [contractRun], runId: contractRun.id, reviews: [] });
  expect(html).toContain("Contract checks");
  expect(html).toContain('nav aria-label="Contract checks"');
  expect(html).toContain('nav aria-label="Scenario cases"');
  expect(html).toContain("Fictional contract check");
  expect(html).toContain("Contract checks: <strong>failed</strong> · Commercial checks: <strong>passed</strong>");
  expect(html).toContain("contract check");
  expect(html).toContain("Contract check</small>");
  expect(html).not.toContain("Fixed <contract>");
});

it("renders independent expected amounts and missing information without replacing them with calculator output", () => {
  const example: Scenario = { ...scenario,
    expectedQuote: { ...scenario.startingQuote, lines: [{ id: "panel", sectionId: "", description: "Panneau", mode: "quantity", quantity: "1", unit: "pce", unitPrice: "123.00", amount: "" }] },
    // Deliberately different from quantity × price to detect accidentally using the calculator in the expected pane.
    expectedCalculation: { lines: [{ amount: 999 }], sections: [], subtotal: 999, discount: 0, net: 999, vat: null, total: null, complete: false, missing: [{ path: "vatRegistered", code: "required" }], errors: [] },
  };
  const html = renderReport({ scenarios: [example], runs: [], reviews: [] });
  expect(html).toContain("9.99\u00a0CHF");
  expect(html).toContain("Expected missing information (1)");
});
