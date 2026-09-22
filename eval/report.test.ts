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
  expect(html).toContain("FAIL</strong> One work line");
  expect(html).toContain("Assertions: 0 passed, 1 failed");
  expect(html).toContain('href="#human-review"');
  expect(html).toContain("[missing]");
  expect(html).toContain("Save a new review");
  expect(html).toContain("Expected / actual final Quote");
  const review: HumanReview = { format: "quote-evaluation-review/v1", id: "review-1", runId: run.id, scenarioHash: run.scenarioHash, createdAt: run.startedAt, reviewer: "Maintainer", wording: "pass", inventedFacts: "pass", clarification: "pending", notes: "Still checking" };
  expect(renderReport({ scenarios: [scenario], runs: [run], runId: run.id, reviews: [review] })).toContain("Human review: <strong>pending</strong>");
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
