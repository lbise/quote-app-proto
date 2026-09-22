import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { configuredQuoteAI } from "../app/lib/quote-ai-config.server";
import { emptyQuote } from "../app/lib/quote";
import { createLiveSession } from "./live";
import { runScenario } from "./runner";
import { scenarios } from "./scenarios";
import type { Scenario } from "./types";

it("rejects manual-only scenarios instead of labeling a zero-call case a live-model pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-manual-only-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-22T12:00:00Z"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    const manual: Scenario = { ...scenarios[0], steps: [{ kind: "manual", note: "Manual edit only", quote: scenarios[0].startingQuote, assertions: [] }] };
    expect(() => createLiveSession({ modelBoundary: boundary, scenarios: [manual], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd: 1, artifactRoot: root })).toThrow("Artisan message");
  } finally { clock.mockRestore(); await rm(root, { recursive: true, force: true }); }
});

it("refuses an expired price review before creating a live session", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-expired-"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T00:00:00Z"));
  try {
    const boundary = configuredQuoteAI({ QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "controlled-test-key" });
    expect(() => createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
      maxCalls: 1, maxElapsedMs: 1000, maxSpendUsd: 1, artifactRoot: root })).toThrow("pricing review has expired");
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
    maxCalls: 2, maxElapsedMs: 10_000, maxSpendUsd: 2, artifactRoot: root });
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
    const part = requests === 1 ? { functionCall: { name: "edit_quote_details", args: { fields: { title: "SDK bounded" }, evidence: [{ fields: ["title"], source: "current", text }] } } } : { text: "Saved." };
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
