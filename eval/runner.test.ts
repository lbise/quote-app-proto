import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { createModels, createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";

import { emptyQuote } from "../app/lib/quote";
import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { runScenario } from "./runner";
import { createLiveSession } from "./live";
import { scenarios } from "./scenarios";
import type { Assertion, Scenario } from "./types";

const databaseUrl = process.env.EVAL_DATABASE_URL;
let artifactRoot: string;
const evidence = (fields: string[], text: string) => [{ fields, source: "current", text }];

function controlled(responses: FauxResponseStep[]): QuoteAIModelBoundary {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  return { model: provider.getModel(), timeoutMs: 1_000, streamFn: (model, context, options) => models.streamSimple(model, context, options) };
}

const liveModelId = "gemini-3.5-flash-lite";
const liveReservationUsd = 0.58466304;

function providerPayload() {
  return { model: liveModelId, contents: [{ role: "user", parts: [{ text: "controlled input" }] }], config: { maxOutputTokens: 4096 } };
}

function controlledGoogle(responses: FauxResponseStep[], payload: unknown = providerPayload()) {
  const faux = controlled(responses);
  const models = createModels();
  models.setProvider(googleProvider());
  const model = models.getModel("google", liveModelId)!;
  let transports = 0;
  const boundary: QuoteAIModelBoundary = {
    ...faux,
    model,
    streamFn: async (_model, context, options) => {
      await options?.onPayload?.(payload as never, model);
      transports += 1;
      return faux.streamFn(faux.model, context, { ...options, onPayload: undefined });
    },
  };
  return { boundary, transports: () => transports };
}

function googleMessage(content: Parameters<typeof fauxAssistantMessage>[0], stopReason: "stop" | "toolUse", usage?: AssistantMessage["usage"]): AssistantMessage {
  return { ...fauxAssistantMessage(content, { stopReason }), api: "google-generative-ai", provider: "google", model: liveModelId, ...(usage === undefined ? { usage: undefined } : { usage }) } as unknown as AssistantMessage;
}

function scriptedGoogle(messages: Array<(model: QuoteAIModelBoundary["model"]) => ReturnType<typeof createAssistantMessageEventStream>>, payload: unknown = providerPayload()) {
  const models = createModels();
  models.setProvider(googleProvider());
  const model = models.getModel("google", liveModelId)!;
  let transports = 0;
  const boundary: QuoteAIModelBoundary = {
    model,
    timeoutMs: 1_000,
    streamFn: async (_model, _context, options) => {
      await options?.onPayload?.(payload as never, model);
      transports += 1;
      const stream = messages.shift();
      if (!stream) throw new Error("Unexpected controlled provider call.");
      return stream(model);
    },
  };
  return { boundary, transports: () => transports };
}

function done(message: AssistantMessage) {
  return () => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(); });
    return stream;
  };
}

function liveSession(boundary: QuoteAIModelBoundary, examples: Scenario[], limits: Partial<Pick<Parameters<typeof createLiveSession>[0], "maxCalls" | "maxElapsedMs" | "maxSpendUsd">> = {}) {
  return createLiveSession({ modelBoundary: boundary, scenarios: examples, approvedProviderDataReview: true, artifactRoot,
    maxCalls: 10, maxElapsedMs: 10_000, maxSpendUsd: 2, ...limits });
}

function scenario(step: Scenario["steps"][number], start = emptyQuote("Q-EVAL")): Scenario {
  return {
    id: `runner-${crypto.randomUUID()}`,
    version: 1,
    title: "Runner seam",
    profession: "joinery",
    provenance: { kind: "synthetic-edge", alias: "runner-test", notes: ["Synthetic test data."] },
    review: { inputs: "approved", expectations: "approved", provider: "blocked", note: "Controlled transport only." },
    locale: "en",
    startingQuote: start,
    history: [],
    steps: [step],
    requiredClarification: [],
    forbiddenMutations: [],
    humanReview: ["Wording remains unreviewed."],
  };
}

const titleAssertion = (title: string): Assertion => ({ label: "title", path: "quote.title", operator: "equals", expected: title });

it("requires live opt-in before accepting a non-faux provider", async () => {
  const boundary = controlled([]);
  await expect(runScenario(scenario({ kind: "artisan", text: "Set title Changed", assertions: [titleAssertion("Changed")] }), {
    databaseUrl: "not-a-database", modelBoundary: { ...boundary, model: { ...boundary.model, provider: "google" } },
  })).rejects.toThrow("live opt-in");
});

it.each(["contract", "commercial"] as const)("rejects a contract check missing %s expectations before database or provider access", async (missing) => {
  const example = scenario({ kind: "artisan", text: "Set title Changed", assertions: missing === "contract"
    ? [titleAssertion("Changed")]
    : [{ label: "no failed calls", path: "failedCalls", operator: "equals", expected: 0, category: "contract" }],
  });
  example.suite = "contract";
  const run = await runScenario(example, { databaseUrl: "not-a-database", modelBoundary: controlled([]) });
  expect(run).toMatchObject({ automated: "invalid", modelCalls: 0, checks: { contract: "invalid", commercial: "invalid" } });
  expect(run.turns[0].assertions[0].label).toContain(`${missing} expectations`);
});

it.each([{ expected: [] }, { expected: "m" }])("rejects malformed alternatives before execution: %j", async ({ expected }) => {
  const example = scenario({ kind: "artisan", text: "Set title Changed", assertions: [
    { label: "unit alternatives", path: "quote.lines[0].unit", operator: "oneOf", expected },
  ] });
  const run = await runScenario(example, { databaseUrl: "not-a-database", modelBoundary: controlled([]) });
  expect(run.automated).toBe("invalid");
  expect(run.modelCalls).toBe(0);
});

describe.runIf(Boolean(databaseUrl))("evaluation runner real HTTP and PostgreSQL seam", () => {
  beforeAll(async () => { artifactRoot = await mkdtemp(join(tmpdir(), "quote-live-eval-")); });
  beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z")); });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await rm(artifactRoot, { recursive: true, force: true }); });

  it.each([
    { repair: false, title: "Changed", contract: "passed", commercial: "passed" },
    { repair: true, title: "Changed", contract: "failed", commercial: "passed" },
    { repair: false, title: "Other", contract: "passed", commercial: "failed" },
  ])("separates contract behavior from commercial correctness: %j", async ({ repair, title, contract, commercial }) => {
    const example = scenario({ kind: "artisan", text: "Set title Changed. Reference note: Other.", assertions: [
      { label: "normal mutation completion", path: "outcome", operator: "equals", expected: "committed", category: "contract" },
      { label: "no rejected calls", path: "failedCalls", operator: "equals", expected: 0, category: "contract" },
      titleAssertion("Changed"),
    ] });
    example.suite = "contract";
    const modelBoundary = controlled([
      ...(repair ? [fauxAssistantMessage([fauxToolCall("unknown_tool", {})], { stopReason: "toolUse" })] : []),
      fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title }, evidence: evidence(["title"], title) })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Done."),
    ]);
    const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary });
    expect(run.checks).toEqual({ contract, commercial });
    expect(run.automated).toBe(contract === "passed" && commercial === "passed" ? "passed" : "failed");
    expect(run.turns[0].after.title).toBe(title);
    expect(run.turns[0].assertions.filter(assertion => assertion.category === "contract")).toHaveLength(2);
  });

  it("runs approved live-mode work through real tools with one shared, pre-reserved spending cap", async () => {
    const text = "Set title Bounded";
    const example = scenario({ kind: "artisan", text, assertions: [titleAssertion("Bounded")] });
    const { boundary, transports } = controlledGoogle([
      fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Bounded" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Saved."),
    ]);
    const live = liveSession(boundary, [example], { maxCalls: 2 });
    try {
      const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: boundary, live });
      expect(run).toMatchObject({ automated: "passed", human: "pending", modelCalls: 2, cost: { ceilingEnforceable: true, reservedUsd: 1.16932608 }, live: { calls: [{ reservedUsd: liveReservationUsd }, { reservedUsd: liveReservationUsd }], sessionCalls: 2, sessionReservedUsd: 1.16932608 } });
      expect(transports()).toBe(2);
      expect(run.turns[0].after.title).toBe("Bounded");
      expect(run.live?.approval).toMatchObject({ scenarioHash: run.scenarioHash, provider: "google", model: "gemini-3.5-flash-lite" });
      expect(example.review.provider).toBe("blocked");
    } finally { live.close(); }
  });
  it("stops before a follow-up call and rolls back staged tool work at the call limit", async () => {
    const text = "Set title Staged";
    const example = scenario({ kind: "artisan", text, assertions: [titleAssertion("Before"), { label: "limit", path: "outcome", operator: "equals", expected: "discarded" }] }, { ...emptyQuote("Q-EVAL"), title: "Before" });
    const usage = { input: 100, output: 40, cacheRead: 20, cacheWrite: 0, totalTokens: 160, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
    const controlled = scriptedGoogle([
      done(googleMessage([fauxToolCall("edit_quote_details", { fields: { title: "Staged" }, evidence: evidence(["title"], text) })], "toolUse", usage)),
    ]);
    const live = liveSession(controlled.boundary, [example], { maxCalls: 1 });
    try {
      const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, live });
      expect(run.turns[0]).toMatchObject({ after: { title: "Before" }, outcome: "discarded" });
      expect(run).toMatchObject({ automated: "failed", modelCalls: 1, cost: { estimatedUsd: 0.0002448, reservedUsd: liveReservationUsd }, live: { stopReason: "call_limit", calls: [{ status: "complete", reservedUsd: liveReservationUsd, estimatedUsd: 0.0002448, usage: { input: 120, output: 40, cacheRead: 20 } }] } });
      expect(controlled.transports()).toBe(1);
    } finally { live.close(); }
  });

  it("admits no request when the shared spend cap is below one reservation", async () => {
    const example = scenario({ kind: "artisan", text: "No change", assertions: [titleAssertion(""), { label: "limit", path: "outcome", operator: "equals", expected: "later_budget_exhausted" }] });
    const controlled = controlledGoogle([fauxAssistantMessage("This must not be sent.")]);
    const live = liveSession(controlled.boundary, [example], { maxSpendUsd: 0.58466303 });
    try {
      const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, live });
      expect(run).toMatchObject({ automated: "failed", modelCalls: 0, cost: { reservedUsd: 0 }, live: { stopReason: "spend_limit", calls: [], sessionCalls: 0, sessionReservedUsd: 0 } });
      expect(controlled.transports()).toBe(0);
    } finally { live.close(); }
  });

  it("does not reset shared call reservations between repetitions", async () => {
    const example = scenario({ kind: "artisan", text: "No change", assertions: [titleAssertion("")] });
    const controlled = scriptedGoogle([
      done(googleMessage("No change.", "stop", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })),
      done(googleMessage("No change.", "stop", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })),
    ]);
    const live = liveSession(controlled.boundary, [example], { maxCalls: 2 });
    try {
      const first = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, repetition: 1, live });
      const second = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, repetition: 2, live });
      const third = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, repetition: 3, live });
      expect(first.automated).toBe("passed");
      expect(second.automated).toBe("passed");
      expect(third).toMatchObject({ automated: "failed", modelCalls: 0, live: { stopReason: "call_limit", calls: [], sessionCalls: 2, sessionReservedUsd: 1.16932608 } });
      expect(controlled.transports()).toBe(2);
    } finally { live.close(); }
  });

  it("stops an unfinished stream at the global deadline without releasing its reservation", async () => {
    const example = scenario({ kind: "artisan", text: "Wait", assertions: [titleAssertion(""), { label: "deadline", path: "outcome", operator: "equals", expected: "later_budget_exhausted" }] });
    const controlled = scriptedGoogle([() => createAssistantMessageEventStream()]);
    const live = liveSession(controlled.boundary, [example], { maxElapsedMs: 1_000 });
    try {
      const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, live });
      expect(run).toMatchObject({ automated: "failed", modelCalls: 1, cost: { reservedUsd: liveReservationUsd }, live: { stopReason: "elapsed_limit", calls: [{ status: "uncertain", reservedUsd: liveReservationUsd }] } });
      expect(controlled.transports()).toBe(1);
    } finally { live.close(); }
  });

  it.each(["partial", "error", "missing", "zero", "malformed"] as const)("stops on %s provider completion without another call or refund", async (kind) => {
    const example = scenario({ kind: "artisan", text: "Stop", assertions: [titleAssertion(""), { label: "terminal", path: "outcome", operator: "equals", expected: "later_budget_exhausted" }] });
    const response = () => {
      const stream = createAssistantMessageEventStream();
      const valid = googleMessage("Ignored", "stop", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
      queueMicrotask(() => {
        if (kind === "partial") { stream.push({ type: "start", partial: valid }); stream.end(); return; }
        if (kind === "error") { stream.push({ type: "error", reason: "error", error: { ...valid, stopReason: "error", errorMessage: "controlled failure" } }); return; }
        if (kind === "missing") { stream.push({ type: "done", reason: "stop", message: googleMessage("Ignored", "stop") }); stream.end(); return; }
        const usage = kind === "zero"
          ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
          : { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        stream.push({ type: "done", reason: "stop", message: googleMessage("Ignored", "stop", usage) });
        stream.end();
      });
      return stream;
    };
    const controlled = scriptedGoogle([response]);
    const live = liveSession(controlled.boundary, [example]);
    try {
      const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, live });
      expect(run).toMatchObject({ automated: "failed", modelCalls: 1, cost: { estimatedUsd: null, reservedUsd: liveReservationUsd }, live: { stopReason: expect.any(String), calls: [{ status: "uncertain", reservedUsd: liveReservationUsd }], sessionReservedUsd: liveReservationUsd } });
      expect(controlled.transports()).toBe(1);
    } finally { live.close(); }
  });

  it("rejects changed approval data or a changed model before any controlled transport", async () => {
    const approved = scenario({ kind: "artisan", text: "No change", assertions: [titleAssertion("")] });
    const controlled = controlledGoogle([fauxAssistantMessage("This must not be sent.")]);
    const live = liveSession(controlled.boundary, [approved]);
    try {
      await expect(runScenario({ ...approved, version: 2 }, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, live })).rejects.toThrow("approval");
      await expect(runScenario(approved, { databaseUrl: databaseUrl!, modelBoundary: { ...controlled.boundary, model: { ...controlled.boundary.model, id: "gemini-3.5-flash-lite-other" } }, live })).rejects.toThrow("provider/model changed");
      expect(controlled.transports()).toBe(0);
    } finally { live.close(); }
  });

  it.each([
    { ...providerPayload(), config: { maxOutputTokens: 4096, addons: [] } },
    { ...providerPayload(), contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "AA==" } }] }] },
  ])("rejects unsupported Google payload data before the controlled transport", async (payload) => {
    const example = scenario({ kind: "artisan", text: "No change", assertions: [titleAssertion(""), { label: "payload", path: "outcome", operator: "equals", expected: "later_budget_exhausted" }] });
    const controlled = scriptedGoogle([done(googleMessage("This must not be sent.", "stop"))], payload);
    const live = liveSession(controlled.boundary, [example]);
    try {
      const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled.boundary, live });
      expect(run).toMatchObject({ automated: "failed", modelCalls: 1, cost: { reservedUsd: liveReservationUsd }, live: { stopReason: expect.any(String), calls: [{ status: "uncertain", reservedUsd: liveReservationUsd }] } });
      expect(controlled.transports()).toBe(0);
    } finally { live.close(); }
  });

  it("keeps manual fallback separate from the assistant conversation", async () => {
    const example = scenarios.find(item => item.id === "joinery-manual-fallback-section-delete")!;
    const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled([fauxAssistantMessage("Utilisez les commandes manuelles pour supprimer cette section.")]) });
    expect(run.automated).toBe("passed");
    expect(run.turns[1]).toMatchObject({ kind: "manual", outcome: "manual_saved", message: "" });
  });

  it.each([false, true])("accepts a zero-quantity clarification with a rejected tool call: %s", async (attemptTool) => {
    const example = scenarios.find(item => item.id === "joinery-zero-is-not-missing")!;
    const text = (example.steps[0] as { text: string }).text;
    const rejection = fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
      lines: [{ description: "Fenêtre", mode: "quantity", quantity: "0", unit: "pce", unitPrice: "240.00", amount: "" }],
      evidence: evidence(["/lines/0/description", "/lines/0/mode", "/lines/0/quantity", "/lines/0/unit", "/lines/0/unitPrice"], text),
    })], { stopReason: "toolUse" });
    const run = await runScenario(example, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      ...(attemptTool ? [rejection] : []), fauxAssistantMessage("La quantité doit être positive. Combien de fenêtres souhaitez-vous ?"),
    ]) });
    expect(run.automated).toBe("passed");
    expect(run.turns[0]).toMatchObject({ outcome: attemptTool ? "unchanged_with_failed_calls" : "unchanged", failedCalls: attemptTool ? 1 : 0 });
  });

  it("returns a timed-out run even when the model never supplies final usage", async () => {
    const modelBoundary = controlled([]);
    const run = await runScenario(scenario({ kind: "artisan", text: "Set title Waiting", assertions: [{ label: "timeout", path: "outcome", operator: "equals", expected: "later_budget_exhausted" }] }), {
      databaseUrl: databaseUrl!, modelBoundary: { ...modelBoundary, timeoutMs: 100, streamFn: () => createAssistantMessageEventStream() },
    });
    expect(run).toMatchObject({ modelCalls: 1, usage: null });
    expect(run.turns[0].outcome).toBe("later_budget_exhausted");
  });
  it("marks a false success as failed when it commits no claimed change", async () => {
    const run = await runScenario(scenario({ kind: "artisan", text: "Set title Changed", assertions: [titleAssertion("Changed")] }), {
      databaseUrl: databaseUrl!, modelBoundary: controlled([fauxAssistantMessage([fauxText("Changed.")])]),
      modelSettings: { transport: "faux-controlled", providerCalls: false, intentionallyNoop: true },
    });
    expect(run.automated).toBe("failed");
    expect(run.model).toMatchObject({ provider: "faux", settings: {
      transport: "faux-controlled", providerCalls: false, intentionallyNoop: true,
      generation: { maxTokens: 4096, maxRetries: 0, cacheRetention: "none", thinkingLevel: "off", timeoutMs: 1_000 },
    } });
    expect(run.revision.promptTools).toMatch(/^[a-f0-9]{64}$/);
    expect(run.turns[0]).toMatchObject({ step: 0, outcome: "unchanged", after: { title: "" } });
  });

  it("keeps the real tool executor when an invalid call is repaired", async () => {
    const text = "Set title Repaired";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Repaired"), { label: "one failed call", path: "failedCalls", operator: "equals", expected: 1 }] }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Repaired" } })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Repaired" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Repaired."),
      ]),
    });
    expect(run.automated).toBe("passed");
    expect(run.turns[0]).toMatchObject({ failedCalls: 1, outcome: "committed_with_failed_calls", after: { title: "Repaired" } });
  });

  it("commits partial work below the third failed call", async () => {
    const text = "Set title Partial";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Partial"), { label: "one failed call", path: "failedCalls", operator: "equals", expected: 1 }] }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([
          fauxToolCall("edit_quote_details", { fields: { title: "Partial" }, evidence: evidence(["title"], text) }),
          fauxToolCall("edit_quote_details", { fields: { title: "Missing evidence" } }),
        ], { stopReason: "toolUse" }),
        fauxAssistantMessage("Partial change saved."),
      ]),
    });
    expect(run.turns[0]).toMatchObject({ outcome: "committed_with_failed_calls", failedCalls: 1, after: { title: "Partial" } });
  });

  it("discards staged success with the whole turn at the third failed call", async () => {
    const start = { ...emptyQuote("Q-EVAL"), title: "Before" };
    const text = "Break it, then stage Staged title.";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Before"), { label: "terminal failure", path: "outcome", operator: "equals", expected: "failed_call_limit_reached" }] }, start), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([
          fauxToolCall("unknown_tool", {}),
          fauxToolCall("edit_quote_details", { fields: { title: "Staged" }, evidence: evidence(["title"], text) }),
          fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}),
        ], { stopReason: "toolUse" }),
      ]),
    });
    expect(run.turns[0]).toMatchObject({ outcome: "failed_call_limit_reached", failedCalls: 3, after: { title: "Before" }, diagnostic: { attempts: expect.arrayContaining([expect.objectContaining({ name: "edit_quote_details", outcome: "applied" })]) } });
  });

  it("preserves a concurrent manual save and reports the assistant response stale", async () => {
    const text = "Set title Assistant";
    const run = await runScenario(scenario({
      kind: "artisan", text, concurrentManualQuote: { ...emptyQuote("Q-EVAL"), title: "Manual" },
      assertions: [titleAssertion("Manual"), { label: "stale", path: "outcome", operator: "equals", expected: "stale" }],
    }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Assistant" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Assistant."),
      ]),
    });
    expect(run).toMatchObject({ modelCalls: 2 });
    expect(run.turns[0]).toMatchObject({ step: 0, outcome: "stale", after: { title: "Manual" }, debug: { outcome: "stale", attempts: [{ name: "edit_quote_details", outcome: "applied", result: { content: expect.any(Array) } }] } });
  });

  it("marks absent assertion values invalid and requires explicit terminal outcomes", async () => {
    const invalid = await runScenario(scenario({ kind: "artisan", text: "Anything", assertions: [{ label: "missing", path: "quote.title", operator: "equals" }] }), {
      databaseUrl: databaseUrl!, modelBoundary: controlled([]),
    });
    expect(invalid).toMatchObject({ automated: "invalid", turns: [{ assertions: [{ label: "Scenario step 1 has an assertion without an expected value" }] }] });

    const start = { ...emptyQuote("Q-EVAL"), title: "Before" };
    const terminal = await runScenario(scenario({ kind: "artisan", text: "Break", assertions: [titleAssertion("Before")] }, start), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([fauxAssistantMessage([fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {})], { stopReason: "toolUse" })]),
    });
    expect(terminal).toMatchObject({ automated: "failed", turns: [{ assertions: expect.arrayContaining([expect.objectContaining({ label: "Terminal HTTP outcome is explicitly expected", passed: false })]) }] });
  });

  it("leaves human review pending after success", async () => {

    const text = "Set title Reviewed later";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Reviewed later")] }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Reviewed later" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Saved."),
      ]),
    });
    expect(run).toMatchObject({ automated: "passed", human: "pending" });
  });
});
