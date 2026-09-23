import { expect, it } from "vitest";
import { emptyQuote } from "../app/lib/quote";
import { renderReport } from "./report";
import type { EvaluationRun, EvaluationSessionRecord, HumanReview, Scenario } from "./types";
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
  expect(html).toContain('<details class="evidence-panel"><summary>Scenario metadata, source and adaptations</summary>');
  expect(html).toContain('<details class="evidence-panel" id="script" open>');
  expect(html).toContain("Ask for the missing amount.");
  expect(html).toContain("No invented price");
  expect(html).toContain("French wording");
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
  expect(html).toContain('<form method="post" action="/reviews">');
  expect(html).toContain(`name="scenarioHash" value="${run.scenarioHash}"`);
  expect(html).toContain("Tool attempts");
  expect(html).toContain("Model requests, tool results and diagnostics");
  expect(html).toContain("Changed fields");
  expect(html).toContain("Expected / actual final Quote");
  const failureSection = html.slice(html.indexOf('<section aria-labelledby="failures-heading">'), html.indexOf('<details class="evidence-panel" id="execution">'));
  expect(failureSection).toContain('class="failure-table"');
  expect(failureSection).toContain('href="#turn-0"');
  expect(failureSection).toContain('data-label="Expected"');
  expect(failureSection).toContain('data-label="Actual"');
  expect(failureSection).toContain('headers="failed-check-0-0 failure-expected"');
  expect(failureSection).toContain('headers="failed-check-0-0 failure-actual"');
  expect(failureSection).toContain('scope="col" id="failure-expected"');
  expect(failureSection).toContain('scope="col" id="failure-actual"');
  expect(failureSection).toContain('Expected</span><pre>1</pre>');
  expect(failureSection).toContain('Actual</span><pre>[missing]</pre>');
  expect(html.indexOf("Failures and execution issues")).toBeLessThan(html.indexOf("Scenario metadata, source and adaptations"));
  for (const id of ["execution", "comparison", "script"]) {
    expect(html).toContain(`<details class="evidence-panel" id="${id}">`);
    expect(html).not.toContain(`id="${id}" open`);
  }
  expect(html).toContain('id="turn-0"');
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
  const runtimeOnly: EvaluationRun = { ...live, turns: [{ ...live.turns[0], assertions: [], error: "Provider <failure>", failedCalls: 2 }] };
  const runtimeHtml = renderReport({ scenarios: [scenario], runs: [runtimeOnly], runId: runtimeOnly.id, reviews: [] });
  const runtimeFailures = runtimeHtml.slice(runtimeHtml.indexOf('id="failures-heading"'), runtimeHtml.indexOf('<details class="evidence-panel" id="execution">'));
  expect(runtimeFailures).toContain("Provider &lt;failure&gt;");
  expect(runtimeFailures).toContain("2 failed calls recorded");
  expect(runtimeFailures).toContain("Live session stopped: usage_unavailable");
  expect(runtimeFailures).toContain('href="#turn-0"');
  expect(runtimeFailures).toContain('href="#execution"');
  expect(runtimeFailures).not.toContain("No failed assertions");
  const noEvidence = { ...run, turns: [] };
  const noEvidenceHtml = renderReport({ scenarios: [scenario], runs: [noEvidence], runId: noEvidence.id, reviews: [] });
  expect(noEvidenceHtml).toContain("No failed assertions or execution issues were recorded.");
  expect(noEvidenceHtml).toContain("The saved automated outcome is not passed");
  expect(noEvidenceHtml).toContain("No conversation steps were recorded.");
  expect(noEvidenceHtml).toContain("No final Quote was recorded.");
  expect(noEvidenceHtml).toContain('id="execution"');
  expect(noEvidenceHtml).toContain('href="#execution"');
  const passedHtml = renderReport({ scenarios: [scenario], runs: [{ ...noEvidence, automated: "passed" }], runId: run.id, reviews: [] });
  expect(passedHtml).toContain('class="status passed"');
  expect(passedHtml).toContain("This does not establish human approval.");
  expect(passedHtml).toContain("Human review: <strong>pending</strong>");
  const escaped: EvaluationRun = { ...run, turns: [{ ...run.turns[0], assertions: [{ ...run.turns[0].assertions[0], label: "<img src=x>", path: "<path>", expected: "<script>bad()</script>", actual: { apiKey: "secret-key", text: "<svg>" + "x".repeat(1000) } }] }] };
  const escapedHtml = renderReport({ scenarios: [scenario], runs: [escaped], runId: run.id, reviews: [] });
  const escapedFailures = escapedHtml.slice(escapedHtml.indexOf('id="failures-heading"'), escapedHtml.indexOf('<details class="evidence-panel" id="execution">'));
  expect(escapedFailures).toContain("&lt;img src=x&gt;");
  expect(escapedFailures).toContain("&lt;path&gt;");
  expect(escapedFailures).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(escapedFailures).toContain("&lt;svg&gt;");
  expect(escapedFailures).toContain("…");
  expect(escapedFailures).not.toContain("secret-key");
  expect(escapedHtml).toContain("x".repeat(1000));
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
  expect(html).not.toContain('nav aria-label="Contract checks"');
  expect(html).not.toContain('nav aria-label="Scenario cases"');
  expect(html).toContain("Fictional contract check");
  expect(html).toContain("Contract checks: <strong>failed</strong> · Commercial checks: <strong>passed</strong>");
  expect(html).toContain("contract check");
  expect(html).toContain("Automated: <strong>failed</strong>");
  expect(html).not.toContain("Fixed <contract>");
  const unknownChecks = { ...contractRun, checks: { contract: "unknown", commercial: "passed" } } as unknown as EvaluationRun;
  const unknownHtml = renderReport({ scenarios: [contractScenario], runs: [unknownChecks], runId: unknownChecks.id, reviews: [] });
  expect(unknownHtml).toContain("Contract checks: unavailable · Commercial checks: unavailable (not recorded)");
  expect(unknownHtml).not.toContain("Contract checks: <strong>unknown</strong>");
});

it("provides a compact shell and early theme script on read-only and executable reports", () => {
  for (const executionEnabled of [false, true]) {
    const html = renderReport({ scenarios: [scenario], runs: [], reviews: [], historyView: true, executionEnabled });
    expect(html).toContain('<script src="/report-ui.js"></script>');
    expect(html.indexOf('/report-ui.js')).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain('<header class="masthead">');
    expect(html).toContain('<a href="/" aria-current="page">Sessions</a>');
    expect(html).toContain('<a href="/?view=library">Scenario library</a>');
    expect(html).toContain('type="button" id="theme-toggle" aria-label="Switch to dark theme"');
    expect(html).toContain('href="#main"');
    expect(html).toContain('<main class="workbench" id="main"');
    expect(html).not.toContain('<aside');
    expect(html.includes('<a href="/?launch=1">New evaluation</a>')).toBe(executionEnabled);
    expect(html.includes('<script src="/execution.js" defer></script>')).toBe(executionEnabled);
  }
});

it("shows grouped scenario links only in the explicit library view", () => {
  const contract: Scenario = { ...scenario, id: "contract&1", title: "Edit contract", suite: "contract" };
  const html = renderReport({ scenarios: [contract, scenario], runs: [], reviews: [], libraryView: true });
  expect(html).toContain('<h1>Scenario library</h1>');
  expect(html).toContain('class="library-grid"');
  expect(html).toContain('nav aria-label="Contract checks"');
  expect(html).toContain('nav aria-label="Scenario cases"');
  expect(html).toContain('class="scenario-links"');
  expect(html).toContain('href="/?scenario=contract%261"');
  expect(html).toContain('Joinery &lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('Starting Working Draft');
  const empty = renderReport({ scenarios: [], runs: [], reviews: [], libraryView: true });
  expect(empty.match(/None available\./g)).toHaveLength(2);
});

it("summarizes saved outcomes independently of completed session execution and preserves older runs", () => {
  const run: EvaluationRun = {
    format: "quote-evaluation/v1", id: "saved-1", sessionId: "session-1", scenarioHash: "hash", scenario, startedAt: "2026-09-01T12:30:00Z",
    revision: { application: "test", promptTools: "test", dirty: false }, model: { provider: "faux", id: "controlled", settings: {} },
    repetition: 1, elapsedMs: 10, usage: null, cost: { estimatedUsd: 0.25, assumptions: "Offline", ceilingEnforceable: false }, modelCalls: 1,
    automated: "failed", human: "pending", turns: [],
  };
  const session: EvaluationSessionRecord = {
    plan: { format: "quote-evaluation-session/v1", id: "session-1", createdAt: run.startedAt, mode: "offline-smoke",
      selection: { scenarioIds: [scenario.id], repetitions: 2 }, model: { provider: "faux", id: "controlled", requested: {}, effective: {} },
      launchAuthorization: { method: "browser-start", at: run.startedAt, scenarioHashes: [run.scenarioHash] }, limits: null, pricing: null,
      work: [1, 2].map(repetition => ({ id: `saved-${repetition}`, scenarioId: scenario.id, scenarioHash: run.scenarioHash, repetition })) },
    state: { status: "completed", startedAt: run.startedAt, finishedAt: "2026-09-01T12:31:00Z", calls: 2, reservedUsd: 0,
      work: [1, 2].map(repetition => ({ id: `saved-${repetition}`, runId: `saved-${repetition}`, status: "completed" })) },
  };
  const passed = { ...run, id: "saved-2", repetition: 2, automated: "passed" as const };
  const legacy = { ...run, id: "older-1", sessionId: undefined, model: { ...run.model, provider: "unknown-provider" } };
  const html = renderReport({ scenarios: [scenario], runs: [run, passed, legacy], sessions: [session], reviews: [], historyView: true, executionEnabled: true });
  expect(html).toContain('<div class="session-summary"><h2>controlled</h2>');
  expect(html).toContain('1 Sept 2026, 12:30');
  expect(html).toContain('Execution: <strong>completed</strong> · Automated: 1 failed, 1 passed');
  expect(html).toContain('1 selected scenario · 2 Scenario Runs');
  expect(html).toContain('Estimated usage cost: USD 0.500000');
  expect(html).toContain('Open progress and results');
  expect(html).toContain('Reuse selection and settings');
  expect(html).toContain('href="/?run=saved-1"');
  expect(html).toContain('href="/?run=older-1"');
  expect(html).toContain('Mode unavailable');
  expect(html).not.toContain('<h2>session-1</h2>');
  const missing = renderReport({ scenarios: [scenario], runs: [run], sessions: [session], reviews: [], historyView: true });
  expect(missing).toContain('Automated: 1 failed, 1 unavailable');
  expect(missing).toContain('Estimated usage cost: unavailable');
  const running = { ...session, state: { ...session.state, status: "running" as const, finishedAt: null, work: [{ id: "saved-1", status: "completed" as const, runId: "saved-1" }, { id: "saved-2", status: "running" as const }] } };
  const pending = renderReport({ scenarios: [scenario], runs: [run], sessions: [running], reviews: [], historyView: true });
  expect(pending).toContain('Automated: 1 failed, 1 pending');
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
