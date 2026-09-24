import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { configuredQuoteAI } from "../app/lib/quote-ai-config.server";
import { emptyQuote } from "../app/lib/quote";
import { generateQuoteChange } from "../app/lib/quote-assistant.server";
import { createLiveSession } from "./live";
import { runScenario } from "./runner";
import { scenarios } from "./scenarios";
import type { Scenario } from "./types";

it("records a bounded Google terminal reason before wrapping a provider error", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-terminal-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
    maxCalls: 1, maxElapsedMs: 10_000, maxSpendUsd: 1, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 4096 } });
  const network = vi.fn(async () => new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: "SAFETY" }],
    usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 120 } })}\n\n`,
  { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", network);
  try {
    const { boundary: wrapped, evidence } = live.forRun(scenarios[0], boundary);
    const stream = await wrapped.streamFn(boundary.model, { messages: [{ role: "user", content: "Controlled terminal response", timestamp: Date.now() }] });
    const events = [];
    for await (const event of stream) events.push(event);

    expect(network).toHaveBeenCalledTimes(1);
    expect(evidence().calls).toMatchObject([{ status: "uncertain", stopReason: "error", rawStopReason: "SAFETY" }]);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", error: expect.objectContaining({ stopReason: "error", rawStopReason: "SAFETY", errorMessage: "Live evaluation stopped: provider_error." }) }));
  } finally {
    live.close();
    vi.unstubAllGlobals();
    clock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it("records MAX_TOKENS on a complete zero-output Google completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-length-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
    maxCalls: 1, maxElapsedMs: 10_000, maxSpendUsd: 1, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 4096 } });
  const network = vi.fn(async () => new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }],
    usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 120 } })}\n\n`,
  { status: 200, headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", network);
  try {
    const { boundary: wrapped, evidence } = live.forRun(scenarios[0], boundary);
    const stream = await wrapped.streamFn(boundary.model, { messages: [{ role: "user", content: "Controlled length response", timestamp: Date.now() }] });
    const events = [];
    for await (const event of stream) events.push(event);

    expect(network).toHaveBeenCalledTimes(1);
    expect(evidence().calls).toMatchObject([{ status: "complete", stopReason: "length", rawStopReason: "MAX_TOKENS", usage: { input: 120, output: 0, cacheRead: 20 } }]);
    expect(events).toContainEqual(expect.objectContaining({ type: "done", reason: "length", message: expect.objectContaining({ stopReason: "length", rawStopReason: "MAX_TOKENS" }) }));
  } finally {
    live.close();
    vi.unstubAllGlobals();
    clock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects an over-cap follow-up locally and admits the next Scenario Run", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-run-cap-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
  const network = vi.fn(async () => new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "No change." }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 } })}\n\n`, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", network);
  let live: ReturnType<typeof createLiveSession> | undefined;
  try {
    live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 2, callsPerRun: 1, maxElapsedMs: 10_000, maxSpendUsd: 2, artifactRoot: root,
      generation: { reasoning: "minimal", maxOutputTokens: 4096 } });
    const input = { messages: [{ role: "user" as const, content: "Controlled", timestamp: Date.now() }] };
    const first = live.forRun(scenarios[0], boundary);
    const response = await first.boundary.streamFn(boundary.model, input);
    for await (const _event of response) { /* Settle the reservation. */ }
    expect(() => first.boundary.streamFn(boundary.model, input)).toThrow("run_call_limit");
    expect(first.evidence()).toMatchObject({ stopReason: "run_call_limit", sessionCalls: 1, calls: [{ status: "complete" }] });
    expect(live.stopped).toBeUndefined();
    const second = live.forRun(scenarios[0], boundary);
    const next = await second.boundary.streamFn(boundary.model, input);
    for await (const _event of next) { /* Settle the reservation. */ }
    expect(second.evidence()).toMatchObject({ sessionCalls: 2, calls: [{ number: 2, status: "complete" }] });
    expect(second.evidence().stopReason).toBeUndefined();
    expect(live.limits).toEqual({ callsPerRun: 1, maxCalls: 2, maxElapsedMs: 10_000, maxSpendUsd: 2 });
    expect(network).toHaveBeenCalledTimes(2);
    const ledger = (await readFile(join(root, "live-sessions", `${live.id}.jsonl`), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(ledger[0].limits).toMatchObject({ callsPerRun: 1, maxCalls: 2 });
    expect(ledger.filter(entry => entry.scenarioHash && entry.call?.status === "reserved")).toHaveLength(2);
  } finally { live?.close(); vi.unstubAllGlobals(); clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it("rejects manual-only scenarios instead of labeling a zero-call case a live-model pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-manual-only-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    const manual: Scenario = { ...scenarios[0], steps: [{ kind: "manual", note: "Manual edit only", quote: scenarios[0].startingQuote, assertions: [] }] };
    expect(() => createLiveSession({ modelBoundary: boundary, scenarios: [manual], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd: 1, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 4096 } })).toThrow("Artisan message");
  } finally { clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it("refuses an expired price review before creating a live session", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-expired-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T00:00:00Z"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    expect(() => createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd: 1, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 4096 } })).toThrow("pricing review has expired");
  } finally { clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it("passes explicit evaluation generation through Agent to the Google request", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-generation-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
    maxCalls: 1, maxElapsedMs: 10_000, maxSpendUsd: 1, artifactRoot: root, generation: { reasoning: "high", maxOutputTokens: 1024 } });
  const network = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig).toEqual(expect.objectContaining({ candidateCount: 1, maxOutputTokens: 1024,
      thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } }));
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "No changes needed." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 30, totalTokenCount: 150 } })}\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", network);
  try {
    const { boundary: wrapped } = live.forRun(scenarios[0], boundary);
    const result = await generateQuoteChange({ quote: emptyQuote("EVAL-SETTINGS"), messages: [], text: "Do not change the draft.", locale: "en" }, wrapped);
    expect(result.quote).toBeNull();
    expect(network).toHaveBeenCalledTimes(1);
    expect(live.effectiveGeneration).toEqual({ reasoning: "high", maxOutputTokens: 1024 });
    expect(live.pricing.maxOutputTokens).toBe(4096);
    expect(live.limits).toEqual({ maxCalls: 1, maxElapsedMs: 10_000, maxSpendUsd: 1 });
    expect(live.calls).toMatchObject([{ reservedUsd: 0.57083904, status: "complete" }]);
  } finally {
    live.close();
    vi.unstubAllGlobals();
    clock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { maxSpendUsd: 4.1, calls: 1 }, { maxSpendUsd: 8.2, calls: 1 }, { maxSpendUsd: 16.4, calls: 1 },
  { maxSpendUsd: 1e-9, calls: 0 }, { maxSpendUsd: 1_000_000, calls: 1 },
  { maxSpendUsd: 0.58466304, calls: 1 }, { maxSpendUsd: 0.584663039, calls: 0 },
])("enforces the exact decimal cap $maxSpendUsd at the live boundary", async ({ maxSpendUsd, calls }) => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-decimal-limit-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  const network = vi.fn(async () => new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "No change." }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 } })}\n\n`, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", network);
  let live: ReturnType<typeof createLiveSession> | undefined;
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 2, maxElapsedMs: 10000, maxSpendUsd, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 4096 } });
    const { boundary: wrapped } = live.forRun(scenarios[0], boundary);
    const completion = generateQuoteChange({ quote: emptyQuote("DECIMAL-LIMIT"), messages: [], text: "Do not change the draft.", locale: "en" }, wrapped);
    if (calls) expect((await completion).quote).toBeNull();
    else await expect(completion).rejects.toThrow("could not complete this request");
    expect(live.limits.maxSpendUsd).toBe(maxSpendUsd);
    expect(live.calls).toHaveLength(calls);
    expect(network).toHaveBeenCalledTimes(calls);
    if (!calls) expect(live.stopReason).toBe("spend_limit");
  } finally {
    live?.close(); vi.unstubAllGlobals(); clock.mockRestore(); await rm(root, { recursive: true, force: true });
  }
});

it.each([0, -1, 1e-10, 1.0000000001, 1_000_000.000000001, NaN, Infinity])("rejects invalid numeric live cap %s without rounding it into an allowance", async maxSpendUsd => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-invalid-limit-"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    expect(() => createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd, artifactRoot: root, generation: { reasoning: "minimal" } })).toThrow("USD must be a positive amount");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("requires an explicit supported Gemini setting and never accepts off", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-settings-validation-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    const create = (generation?: { reasoning?: "off" | "minimal"; maxOutputTokens?: number }) => createLiveSession({
      modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd: 1, artifactRoot: root, generation,
    });
    expect(() => create()).toThrow("requires an explicit");
    expect(() => create({ reasoning: "off" })).toThrow("off is not supported");
    expect(() => create({ reasoning: "minimal", maxOutputTokens: 4097 })).toThrow("at most 4096");
  } finally { clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it("exposes cancellation without releasing durable reservations", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-cancel-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd: 1, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 1024 } });
    live.cancel("user_stop");
    expect(live.stopReason).toBe("user_stop");
    expect(live.calls).toEqual([]);
    live.close();
  } finally { clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it.runIf(Boolean(process.env.EVAL_DATABASE_URL)).each(["success", "http-error"])("uses the registered Google SDK with bounded requests and honest usage: %s", async (responseMode) => {
  const root = await mkdtemp(join(tmpdir(), "eval-google-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  const text = "Set title SDK bounded";
  const example: Scenario = { id: "sdk-bounded", version: 1, title: "Controlled provider response", profession: "joinery", locale: "en",
    provenance: { kind: "synthetic-edge", alias: "sdk-budget-test", notes: [] },
    review: { inputs: "pending", expectations: "pending", provider: "blocked", note: "No network; controlled HTTP responses." },
    startingQuote: emptyQuote("SDK-001"), history: [], steps: [{ kind: "artisan", text,
      assertions: [{ label: "title", path: "quote.title", operator: "equals", expected: "SDK bounded" }] }],
    requiredClarification: [], forbiddenMutations: [], humanReview: [],
  };
  const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key", QUOTE_AI_TIMEOUT_MS: "10000" });
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [example], approvedProviderDataReview: true,
    maxCalls: 2, maxElapsedMs: 10_000, maxSpendUsd: 2, artifactRoot: root, generation: { reasoning: "minimal", maxOutputTokens: 4096 } });
  let requests = 0;
  const network = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    // This stub never delegates to fetch, even if the SDK changes URL shape.
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig).toMatchObject({ candidateCount: 1, maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: "MINIMAL" } });
    expect(body.tools.every((tool: Record<string, unknown>) => Object.keys(tool).join() === "functionDeclarations")).toBe(true);
    const ledger = (await readFile(join(root, "live-sessions", `${live.id}.jsonl`), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(ledger.at(-1).call).toMatchObject({ number: requests + 1, status: "reserved", reservedUsd: 0.58466304 });
    requests += 1;
    if (responseMode === "http-error") return new Response(JSON.stringify({ error: { code: 503, message: "Controlled outage", status: "UNAVAILABLE" } }), { status: 503, headers: { "content-type": "application/json" } });
    const part = requests === 1 ? { functionCall: { name: "edit_quote_details", args: { fields: { title: "SDK bounded" } } } } : { text: "Saved." };
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 120, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 10, totalTokenCount: 160 } })}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", network);
  try {
    const run = await runScenario(example, { databaseUrl: process.env.EVAL_DATABASE_URL!, modelBoundary: boundary, live });
    if (responseMode === "success") {
      expect(run.turns[0].after.title, JSON.stringify(run.turns[0].diagnostic)).toBe("SDK bounded");
      expect(run).toMatchObject({ automated: "passed", modelCalls: 2, usage: { input: 240, output: 80, total: 320 },
        cost: { estimatedUsd: 0.0004896, reservedUsd: 1.16932608, ceilingEnforceable: true } });
      expect(network).toHaveBeenCalledTimes(2);
    } else {
      expect(run).toMatchObject({ automated: "failed", modelCalls: 1, usage: null,
        cost: { estimatedUsd: null, reservedUsd: 0.58466304 }, live: { stopReason: "provider_error" } });
      expect(run.turns[0].after.title).toBe("");
      expect(network).toHaveBeenCalledTimes(1); // No SDK retry hidden behind the reservation.
    }
  } finally {
    live.close();
    vi.unstubAllGlobals();
    clock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
