import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectDatabase } from "./db.server";
import { emptyQuote } from "./quote";
import { configuredQuoteAI } from "./quote-ai-config.server";
import { clearOpenRouterResolutionCache } from "./quote-ai-openrouter.server";
import { databaseSpendLedger, reservedSpendNanoUsd, type QuoteAISpendLedger } from "./quote-ai-spend.server";
import { generateQuoteChange, QuoteAIError, QuoteAIGenerationError } from "./quote-assistant.server";

// Real pi SDK, real Agent and tools; only external HTTP is replaced.
const id = "example/tool-model";
const models = "https://openrouter.ai/api/v1/models";
const endpoints = `https://openrouter.ai/api/v1/models/${id}/endpoints`;
const chat = "https://openrouter.ai/api/v1/chat/completions";
const key = "sk-or-production-secret";
const googleKey = "google-ambient-secret";

const metadata = {
  id, name: "Tool model", context_length: 200_000,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "max_tokens", "reasoning"],
  reasoning: { mandatory: false, supported_efforts: ["none", "low", "high"] },
};
const endpoint = {
  name: "Provider A | tool-model", model_id: id, provider_name: "Provider A", status: 0,
  context_length: 200_000, max_completion_tokens: 4096, supported_parameters: ["tools", "max_tokens", "reasoning"],
  pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000005", input_cache_write: "0.000001" },
};
// Rates round up plus one nanodollar: input 1001, output 2001, cache read 501, cache write 1001, reasoning 1, request 1.
const reservationFor = (maxOutputTokens: number) => 200_000 * 1001 + maxOutputTokens * (2001 + 1) + 1;
const usage = { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 };
const estimate = 1000 * 1001 + 20 * 2001 + 1;

// Every Quote AI variable is explicit: this file imports db.server, which loads
// a developer's .env, and production-path tests read process.env.
const env = {
  QUOTE_AI_PROVIDER: "openrouter", QUOTE_AI_MODEL: id, OPENROUTER_API_KEY: key,
  QUOTE_AI_SPEND_LIMIT_USD: "5", GEMINI_API_KEY: googleKey,
  QUOTE_AI_REASONING: "", QUOTE_AI_MAX_OUTPUT_TOKENS: "", QUOTE_AI_TIMEOUT_MS: "",
};

type Chunk = Record<string, unknown>;
const sse = (...chunks: Chunk[]) => new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } });
const toolCall = (name: string, args: unknown) => [
  { id: "gen-1", model: id, provider: "Provider A", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] },
  { id: "gen-1", model: id, provider: "Provider A", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  { id: "gen-1", model: id, provider: "Provider A", choices: [], usage },
];
const text = (content: string, overrides: Chunk = {}) => [
  { id: "gen-2", model: id, provider: "Provider A", choices: [{ index: 0, delta: { content }, finish_reason: null }], ...overrides },
  { id: "gen-2", model: id, provider: "Provider A", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...overrides },
  { id: "gen-2", model: id, provider: "Provider A", choices: [], usage, ...overrides },
];

function openRouter({ model = metadata, endpointList = [endpoint], responses = [] as Response[], metadataStatus = 200 } = {}) {
  const requests: { body: Record<string, unknown>; authorization: string | null }[] = [];
  let metadataCalls = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === models || url === endpoints) {
      metadataCalls += 1;
      if (metadataStatus !== 200) return new Response("unavailable", { status: metadataStatus });
      return url === models ? Response.json({ data: [model] }) : Response.json({ data: { id, endpoints: endpointList } });
    }
    if (url !== chat) throw new Error(`Unexpected URL: ${url}`);
    requests.push({ body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("No scripted OpenRouter response.");
    return next;
  }) as typeof globalThis.fetch;
  return { fetch, requests, metadataCalls: () => metadataCalls };
}

function memoryLedger(initial = 0) {
  let reserved = initial;
  const ledger: QuoteAISpendLedger = {
    async reserve(nanoUsd, limit) { if (reserved + nanoUsd > limit) return false; reserved += nanoUsd; return true; },
    async release(nanoUsd) { reserved -= nanoUsd; },
  };
  return { ledger, reserved: () => reserved };
}

const input = () => ({ quote: emptyQuote("Q-1"), capturedLineIds: [], messages: [], text: "Title this Quote Kitchen repaint.", locale: "en" as const });

async function run(environment: Record<string, string>, api: ReturnType<typeof openRouter>, ledger = memoryLedger().ledger, now?: () => number) {
  const boundary = await configuredQuoteAI(environment, { fetch: api.fetch, ledger, now });
  return generateQuoteChange(input(), boundary);
}

async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { if (error instanceof QuoteAIError) return error; throw error; }
  throw new Error("Expected the Quote assistant to fail.");
}

/** Production resolves configuration inside generateQuoteChange. */
async function productionFailure(environment: Record<string, string>) {
  const saved = { ...process.env };
  Object.assign(process.env, environment);
  try { return await failure(generateQuoteChange(input())); }
  finally { process.env = saved; }
}

beforeEach(() => clearOpenRouterResolutionCache());

describe("production OpenRouter Quote AI", () => {
  it("runs the real agent through a tool-call follow-up with the exact model, credential, routing and generation", async () => {
    const api = openRouter({ responses: [sse(...toolCall("edit_quote_details", { fields: { title: "Kitchen repaint" } })), sse(...text("Title updated."))] });
    const spend = memoryLedger();
    const result = await run(env, api, spend.ledger);

    expect(result.quote?.title).toBe("Kitchen repaint");
    expect(api.requests).toHaveLength(2);
    for (const request of api.requests) {
      expect(request.authorization).toBe(`Bearer ${key}`);
      expect(request.body).toMatchObject({
        model: id, max_tokens: 4096, stream: true, stream_options: { include_usage: true },
        reasoning: { effort: "none" }, provider: { require_parameters: true, allow_fallbacks: false },
      });
      expect(request.body).not.toHaveProperty("max_completion_tokens");
      expect((request.body.tools as unknown[]).length).toBeGreaterThan(0);
    }
    // Both calls settled to their verified usage.
    expect(spend.reserved()).toBe(2 * estimate);
    expect(result.debug?.llmRequests?.map((request) => request.options)).toEqual([
      expect.objectContaining({ maxTokens: 4096, reasoning: undefined, maxRetries: 0, cacheRetention: "none" }),
      expect.objectContaining({ maxTokens: 4096, reasoning: undefined, maxRetries: 0, cacheRetention: "none" }),
    ]);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain(googleKey);
  });

  it("propagates an explicit supported reasoning level and output limit to every call", async () => {
    const api = openRouter({ responses: [sse(...toolCall("edit_quote_details", { fields: { title: "Kitchen repaint" } })), sse(...text("Done."))] });
    const spend = memoryLedger();
    await run({ ...env, QUOTE_AI_REASONING: "low", QUOTE_AI_MAX_OUTPUT_TOKENS: "1024" }, api, spend.ledger);
    expect(api.requests.map((request) => [request.body.reasoning, request.body.max_tokens])).toEqual([
      [{ effort: "low" }, 1024], [{ effort: "low" }, 1024],
    ]);
  });

  it("rejects unsupported generation settings before any request", async () => {
    for (const settings of [{ QUOTE_AI_REASONING: "medium" }, { QUOTE_AI_MAX_OUTPUT_TOKENS: "4097" }]) {
      const api = openRouter();
      await expect(configuredQuoteAI({ ...env, ...settings }, { fetch: api.fetch, ledger: memoryLedger().ledger })).rejects.toBeInstanceOf(QuoteAIGenerationError);
      expect(api.requests).toHaveLength(0);
    }
    // Mandatory reasoning cannot honour Off, so an unset setting is refused rather than substituted.
    clearOpenRouterResolutionCache();
    const api = openRouter({ model: { ...metadata, reasoning: { mandatory: true, supported_efforts: ["low", "high"] } } });
    await expect(configuredQuoteAI(env, { fetch: api.fetch, ledger: memoryLedger().ledger })).rejects.toThrow("requires an explicit reasoning setting");
    expect(api.requests).toHaveLength(0);
  });

  it("reports invalid generation settings through the production entry point", async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = openRouter().fetch;
    try {
      const error = await productionFailure({ ...env, QUOTE_AI_REASONING: "medium" });
      expect(error.diagnostic).toEqual({ phase: "validation", code: "invalid_generation_settings" });
    } finally { globalThis.fetch = saved; }
  });

  it("refuses unknown, incompatible or unverifiable models without falling back", async () => {
    const cases = [
      openRouter({ model: { ...metadata, id: "example/other-model" } }),
      openRouter({ model: { ...metadata, supported_parameters: ["max_tokens"] } }),
      openRouter({ model: { ...metadata, architecture: { input_modalities: ["image"], output_modalities: ["image"] } } }),
      openRouter({ endpointList: [{ ...endpoint, pricing: { prompt: "0.000001" } as typeof endpoint.pricing }] }),
      openRouter({ metadataStatus: 503 }),
    ];
    for (const api of cases) {
      clearOpenRouterResolutionCache();
      await expect(configuredQuoteAI(env, { fetch: api.fetch, ledger: memoryLedger().ledger })).rejects.toThrow(`OpenRouter model ${id} is unavailable`);
      expect(api.requests).toHaveLength(0);
    }
  });

  it("maps missing production credentials and unavailable metadata to a safe configuration error", async () => {
    const error = await productionFailure({ ...env, OPENROUTER_API_KEY: "" });
    expect(error.diagnostic).toEqual({ phase: "model", code: "provider_configuration_invalid" });
    expect(JSON.stringify(error)).not.toContain(googleKey);
  });

  it("stops before sending when the spending ledger is unavailable", async () => {
    const saved = globalThis.fetch;
    const api = openRouter({ responses: [sse(...text("unused"))] });
    globalThis.fetch = api.fetch;
    try {
      // Never depend on a developer's .env: without a database nothing can be reserved.
      const error = await productionFailure({ ...env, DATABASE_URL: "" });
      expect(error.diagnostic).toMatchObject({ phase: "model", code: "spend_ledger_unavailable" });
      expect(api.requests).toHaveLength(0);
    } finally { globalThis.fetch = saved; }
  });

  it("checks metadata again after a failure and after the cache expires", async () => {
    const down = openRouter({ metadataStatus: 503 });
    await expect(configuredQuoteAI(env, { fetch: down.fetch, ledger: memoryLedger().ledger })).rejects.toThrow("unavailable");
    let now = 1_000_000;
    const api = openRouter();
    await configuredQuoteAI(env, { fetch: api.fetch, ledger: memoryLedger().ledger, now: () => now });
    await configuredQuoteAI(env, { fetch: api.fetch, ledger: memoryLedger().ledger, now: () => now });
    expect(api.metadataCalls()).toBe(2);
    now += 15 * 60_000;
    await configuredQuoteAI(env, { fetch: api.fetch, ledger: memoryLedger().ledger, now: () => now });
    expect(api.metadataCalls()).toBe(4);
  });

  it("stops before sending when the spending allowance cannot cover the next call", async () => {
    const api = openRouter({ responses: [sse(...text("unused"))] });
    const limit = reservationFor(4096) - 1;
    const error = await failure(run({ ...env, QUOTE_AI_SPEND_LIMIT_USD: (limit / 1e9).toFixed(9) }, api));
    expect(error.diagnostic).toMatchObject({ phase: "model", code: "spend_limit_reached" });
    expect(api.requests).toHaveLength(0);
  });

  it("discards staged tool changes when the allowance runs out on a follow-up call", async () => {
    const api = openRouter({ responses: [sse(...toolCall("edit_quote_details", { fields: { title: "Kitchen repaint" } })), sse(...text("unused"))] });
    // Exactly one full reservation remains, and the settled first call keeps its estimate.
    const spend = memoryLedger();
    const limit = reservationFor(4096) + estimate - 1;
    const error = await failure(run({ ...env, QUOTE_AI_SPEND_LIMIT_USD: (limit / 1e9).toFixed(9) }, api, spend.ledger));
    expect(error.diagnostic.code).toBe("spend_limit_reached");
    expect(api.requests).toHaveLength(1);
    expect(spend.reserved()).toBe(estimate);
  });

  it("keeps the full reservation and stops when usage is missing or routing evidence disagrees", async () => {
    const missingUsage = text("Done.").slice(0, 2);
    for (const [chunks, code] of [
      [missingUsage, "openrouter_usage_missing"],
      [text("Done.", { model: "example/substitute" }), "openrouter_model_mismatch"],
    ] as const) {
      clearOpenRouterResolutionCache();
      const api = openRouter({ responses: [sse(...chunks)] });
      const spend = memoryLedger();
      const error = await failure(run(env, api, spend.ledger));
      expect(error.diagnostic).toMatchObject({ phase: "model", code });
      expect(spend.reserved()).toBe(reservationFor(4096));
    }
  });

  it("keeps provider error text and credentials out of diagnostics", async () => {
    const api = openRouter({ responses: [new Response(JSON.stringify({ error: { message: `Invalid key ${key} for Quote Kitchen repaint` } }),
      { status: 401, headers: { "content-type": "application/json" } })] });
    const spend = memoryLedger();
    const error = await failure(run(env, api, spend.ledger));
    // A provider error keeps the existing generic failure code; its body never becomes a diagnostic.
    expect(error.diagnostic.code).toBe("assistant_failed");
    expect(JSON.stringify(error.diagnostic)).not.toContain(key);
    expect(JSON.stringify(error.diagnostic)).not.toContain("Invalid key");
    expect(error.message).not.toContain(key);
    expect(spend.reserved()).toBe(reservationFor(4096));
  });
});

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("production OpenRouter spend ledger", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  afterAll(async () => { await connection.pool.end(); });

  it("reserves atomically across concurrent requests and never exceeds the ceiling", async () => {
    const ledger = databaseSpendLedger(connection.db);
    const before = await reservedSpendNanoUsd(connection.db);
    const results = await Promise.all(Array.from({ length: 10 }, () => ledger.reserve(1_000, before + 3_500)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await reservedSpendNanoUsd(connection.db)).toBe(before + 3_000);
    await ledger.release(400);
    expect(await reservedSpendNanoUsd(connection.db)).toBe(before + 2_600);
    // A release can never drive the allowance negative.
    await ledger.release(Number.MAX_SAFE_INTEGER);
    expect(await reservedSpendNanoUsd(connection.db)).toBe(before + 2_600);
  });
});
