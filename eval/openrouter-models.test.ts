import { describe, expect, it } from "vitest";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { Model } from "@earendil-works/pi-ai";
import { discoverOpenRouterModels, resolveOpenRouterModel } from "./openrouter-models";

const id = "example/new-text-model";
const model = { id, name: "New text model", context_length: 8192,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "max_tokens", "temperature"] };
const endpoint = { name: "Provider A | example/new-text-model", model_id: id, provider_name: "Provider A",
  context_length: 8192, max_completion_tokens: 2048, supported_parameters: ["tools", "max_tokens", "temperature"],
  pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000005", input_cache_write: "0.000001" }, status: 0 };
function api(models: unknown[] = [model], endpoints: unknown[] = [endpoint]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: models });
    if (url === `https://openrouter.ai/api/v1/models/${id}/endpoints`) return Response.json({ data: { id, endpoints } });
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

describe("OpenRouter public model metadata", () => {
  it("resolves a new uncatalogued text/tool model into a pi model dispatched by the installed provider", async () => {
    const resolved = await resolveOpenRouterModel(id, api());
    if (!resolved.model) throw new Error(resolved.reason);
    expect(resolved.model).toMatchObject({ id, provider: "openrouter", api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1", input: ["text"], contextWindow: 8192, maxTokens: 2048,
      cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } });
    expect(resolved.pricing).toMatchObject({ source: "https://openrouter.ai/api/v1/models/example/new-text-model/endpoints", unit: "USD/token", maxInputUsdPerToken: 0.000001, maxOutputUsdPerToken: 0.000002 });
    expect(resolved.endpoints).toHaveLength(1);
    const provider = openrouterProvider();
    expect(provider.id).toBe("openrouter");
    // Dispatch is by model.api, not membership in the bundled catalog.
    expect(provider.getModels().some(m => m.id === id)).toBe(false);
  });

  it("uses the installed OpenRouter SDK transport for an uncatalogued resolved model", async () => {
    const resolved = await resolveOpenRouterModel(id, api());
    if (!resolved.model) throw new Error(resolved.reason);
    let sent: Record<string, unknown> | undefined;
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const sse = 'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\ndata: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":1,"total_tokens":11}}\n\ndata: [DONE]\n\n';
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const answer = await openrouterProvider().streamSimple(resolved.model as Model<"openai-completions">,
      { messages: [{ role: "user", content: "Hello", timestamp: 1 }] },
      { apiKey: "test-only", fetch: transport, maxRetries: 0, cacheRetention: "none", maxTokens: 32 }).result();
    expect(sent).toMatchObject({ model: id, max_tokens: 32, stream: true });
    expect(answer).toMatchObject({ model: id, stopReason: "stop", content: [{ type: "text", text: "Done" }] });
  });

  it("lists unsupported models with reasons, not fabricated defaults", async () => {
    const listing = await discoverOpenRouterModels(api([model, { ...model, id: "example/no-tools", supported_parameters: [] }]));
    expect(listing.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, candidate: true }),
      expect.objectContaining({ id: "example/no-tools", candidate: false, reason: expect.stringMatching(/tools/i) }),
    ]));
  });

  it("refuses to resolve if any routable endpoint lacks tools, price, or a completion bound", async () => {
    for (const changed of [
      { supported_parameters: ["max_tokens"] },
      { pricing: { prompt: "0.000001" } },
      { max_completion_tokens: null },
    ]) {
      const result = await resolveOpenRouterModel(id, api([model], [endpoint, { ...endpoint, ...changed, name: "Provider B" }]));
      expect(result).toMatchObject({ model: null, available: false, reason: expect.any(String) });
    }
  });

  it("takes the worst price and smallest capacity across all routable endpoints", async () => {
    const result = await resolveOpenRouterModel(id, api([model], [endpoint,
      { ...endpoint, name: "Provider B", context_length: 4096, max_completion_tokens: 512,
        pricing: { prompt: "0.000003", completion: "0.000004", input_cache_read: "0.000005", input_cache_write: "0.000006" } }]));
    expect(result.model).toMatchObject({ contextWindow: 4096, maxTokens: 512,
      cost: { input: 3, output: 4, cacheRead: 5, cacheWrite: 6 } });
    expect(result.endpoints).toHaveLength(2);
  });

  it("exposes only model-proven efforts across endpoints and sends explicit Off through pi", async () => {
    const reasoningModel = { ...model, supported_parameters: [...model.supported_parameters, "reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["high", "low", "none"], default_effort: "high", default_enabled: true } };
    const reasoningEndpoint = { ...endpoint, supported_parameters: [...endpoint.supported_parameters, "reasoning"] };
    const resolved = await resolveOpenRouterModel(id, api([reasoningModel], [reasoningEndpoint]));
    expect(resolved).toMatchObject({ available: true,
      reasoning: { supported: true, mandatory: false, offEstablished: true, supportedLevels: ["low", "high"] },
      model: { reasoning: true, thinkingLevelMap: { off: "none", minimal: null, medium: null, xhigh: null } } });
    if (!resolved.model) throw new Error(resolved.reason);
    let sent: Record<string, unknown> | undefined;
    const transport = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('data: {"id":"c1","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    await openrouterProvider().streamSimple(resolved.model as Model<"openai-completions">,
      { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      // Agent represents Off by omitting `reasoning`; the OpenRouter adapter must still send none.
      { apiKey: "test-only", fetch: transport, maxRetries: 0 }).result();
    expect(sent).toMatchObject({ reasoning: { effort: "none" } });
  });

  it("requires an explicit supported effort for mandatory reasoning, without offering Off", async () => {
    const result = await resolveOpenRouterModel(id, api([{ ...model,
      supported_parameters: [...model.supported_parameters, "reasoning"],
      reasoning: { mandatory: true, supported_efforts: ["high", "low"] } }],
    [{ ...endpoint, supported_parameters: [...endpoint.supported_parameters, "reasoning"] }]));
    expect(result).toMatchObject({ available: true, model: { reasoning: true, thinkingLevelMap: { off: null, high: "high", low: "low", medium: null } },
      reasoning: { offEstablished: false, requiresExplicitSelection: true, supportedLevels: ["low", "high"] } });
  });

  it("accepts public-shaped optional-reasoning metadata without a cache-write rate only with caching disabled", async () => {
    // Based on the public inception/mercury-2.5 model and endpoint metadata, not the SDK catalog.
    const result = await resolveOpenRouterModel(id, api([{ ...model, supported_parameters: [...model.supported_parameters, "reasoning"],
      reasoning: { mandatory: false, default_enabled: true, supported_efforts: ["high", "medium", "low", "none"] } }],
    [{ ...endpoint, supported_parameters: [...endpoint.supported_parameters, "reasoning"], supports_implicit_caching: false,
      pricing: { prompt: "0.00000004", completion: "0.00000015", input_cache_read: "0.000000004", discount: 0.8 } }]));
    expect(result.reason).toBeUndefined();
    expect(result).toMatchObject({ available: true, model: { reasoning: true, cost: { input: 0.04, output: 0.15 } },
      reasoning: { offEstablished: true, supportedLevels: ["low", "medium", "high"] },
      pricing: { requiresCacheRetentionNone: true } });
  });

  it("does not claim Off or effort choices when reasoning metadata cannot prove them", async () => {
    const result = await resolveOpenRouterModel(id, api([{ ...model, supported_parameters: [...model.supported_parameters, "reasoning"], reasoning: { mandatory: true } }],
      [{ ...endpoint, supported_parameters: [...endpoint.supported_parameters, "reasoning"] }]));
    expect(result).toMatchObject({ available: false, model: null, reason: expect.stringMatching(/reasoning.*off/i),
      reasoning: { supported: true, mandatory: true, offEstablished: false, supportedLevels: [] } });
  });

  it("allows missing cache rates only when endpoint reports no implicit caching and bounds reads at prompt rate", async () => {
    const result = await resolveOpenRouterModel(id, api([model], [{ ...endpoint, supports_implicit_caching: false,
      pricing: { prompt: "0.000001", completion: "0.000002" } }]));
    expect(result).toMatchObject({ model: { cost: { input: 1, cacheRead: 1 } }, pricing: { requiresCacheRetentionNone: true } });
  });

  it("does not guess missing cache rates", async () => {
    const result = await resolveOpenRouterModel(id, api([model], [{ ...endpoint,
      pricing: { prompt: "0.000001", completion: "0.000002" } }]));
    expect(result).toMatchObject({ model: null, reason: expect.stringMatching(/cache/) });
  });

  it("does not understate cache rates introduced only by a conditional override", async () => {
    const result = await resolveOpenRouterModel(id, api([model], [{ ...endpoint, supports_implicit_caching: false,
      pricing: { prompt: "0.000001", completion: "0.000002", overrides: [
        { min_prompt_tokens: 1000, input_cache_read: "0.000007", input_cache_write: "0.000008" }] } }]));
    expect(result).toMatchObject({ available: true, model: { cost: { cacheRead: 7, cacheWrite: 8 } } });
  });

  it("bounds pricing overrides, extra reasoning tokens and per-request fees instead of using base rates", async () => {
    const result = await resolveOpenRouterModel(id, api([model], [{ ...endpoint,
      pricing: { ...endpoint.pricing, request: "0.001", internal_reasoning: "0.000003",
        overrides: [{ min_prompt_tokens: 1000, prompt: "0.000004", completion: "0.000006", input_cache_read: "0.000005" }] } }]));
    expect(result).toMatchObject({ available: true, model: { cost: { input: 4, output: 9, cacheRead: 5 } },
      pricing: { maxInputUsdPerToken: 0.000004, maxOutputUsdPerToken: 0.000006,
        maxReasoningUsdPerToken: 0.000003, maxRequestUsd: 0.001 } });
  });

  it("rejects unproven reasoning on any routed endpoint", async () => {
    const withReasoning = { ...model, supported_parameters: [...model.supported_parameters, "reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["none", "low"] } };
    const result = await resolveOpenRouterModel(id, api([withReasoning],
      [{ ...endpoint, supported_parameters: [...endpoint.supported_parameters, "reasoning"] },
        { ...endpoint, name: "Provider B" }]));
    expect(result).toMatchObject({ available: false, model: null, reason: expect.stringMatching(/Provider B.*reasoning.*endpoints/) });
  });

  it("accepts null supported_efforts only when model and endpoints explicitly support reasoning", async () => {
    const result = await resolveOpenRouterModel(id, api([{ ...model,
      supported_parameters: [...model.supported_parameters, "reasoning"], reasoning: { mandatory: false, supported_efforts: null } }],
    [{ ...endpoint, supported_parameters: [...endpoint.supported_parameters, "reasoning"] }]));
    expect(result).toMatchObject({ available: true, reasoning: { offEstablished: true,
      supportedLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] } });
  });

  it("rejects malformed or unsupported price overrides", async () => {
    for (const overrides of [[{ prompt: "nan" }], [{ unknown_surcharge: "0.1" }], [{ prompt: "0.000004", min_prompt_tokens: -1 }]]) {
      expect(await resolveOpenRouterModel(id, api([model], [{ ...endpoint, pricing: { ...endpoint.pricing, overrides } }])))
        .toMatchObject({ model: null, reason: expect.stringMatching(/overrides/i) });
    }
  });

  it("rejects endpoints that cannot share one safe output limit parameter", async () => {
    const result = await resolveOpenRouterModel(id, api([model], [endpoint,
      { ...endpoint, name: "Provider B", supported_parameters: ["tools", "max_completion_tokens"] }]));
    expect(result).toMatchObject({ model: null, reason: expect.stringMatching(/output token limit parameter/) });
  });

  it("rejects charge categories it cannot bound and endpoints whose status is unknown", async () => {
    for (const change of [{ pricing: { ...endpoint.pricing, web_search: "0.01" } }, { status: undefined }]) {
      const result = await resolveOpenRouterModel(id, api([model], [{ ...endpoint, ...change }]));
      expect(result).toMatchObject({ available: false, model: null, reason: expect.any(String) });
    }
  });

  it("returns actionable metadata errors without trying alternate models", async () => {
    const result = await resolveOpenRouterModel(id, (async () => new Response("down", { status: 503 })) as typeof fetch);
    expect(result).toMatchObject({ id, available: false, model: null, reason: expect.stringMatching(/503/) });
    expect(await discoverOpenRouterModels((async () => Response.json({ data: {} })) as typeof fetch))
      .toMatchObject({ models: [], error: expect.stringMatching(/malformed/) });
  });
});
