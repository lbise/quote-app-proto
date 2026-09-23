import { expect, it, vi } from "vitest";
import type { Context, Model } from "@earendil-works/pi-ai";
import { createOpenRouterTransport } from "./openrouter-transport";

const model: Model<"openai-completions"> = {
  id: "example/tool-model", name: "Tool model", api: "openai-completions", provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1", reasoning: true, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 10000, maxTokens: 1000,
};
const context: Context = { messages: [{ role: "user", content: "private customer message", timestamp: 1 }],
  tools: [{ name: "edit_quote", description: "Edit", parameters: { type: "object", properties: { title: { type: "string" } } } }] };
const usage = { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42,
  prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 4 } };
const sse = (...chunks: object[]) => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } });
const finish = { id: "gen-123", model: model.id, provider: "test-provider", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
const final = (rawUsage: object) => ({ id: "gen-123", model: model.id, provider: "test-provider", choices: [], usage: rawUsage });
const route = { require_parameters: true, allow_fallbacks: false, only: ["test-provider"] };

it("sends the SDK tool request with exact settings and records only bounded final evidence", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-secret");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: model.id, max_completion_tokens: 128, stream_options: { include_usage: true },
      reasoning: { effort: "none" }, provider: route,
      tools: [{ type: "function", function: { name: "edit_quote" } }] });
    return sse({ id: "gen-123", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "edit_quote", arguments: '{"title":"secret"}' } }] }, finish_reason: null }] }, finish, final(usage));
  });
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events.some(event => event.type === "done")).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(evidence()).toEqual({ status: "complete", requestedModel: model.id, routedModel: model.id, routedProvider: "test-provider",
    responseId: "gen-123", stopReason: "toolUse", usage: { input: 25, cacheRead: 5, cacheWrite: 0, output: 12, reasoning: 4, totalTokens: 42 } });
  expect(JSON.stringify(evidence())).not.toMatch(/secret|private|test-secret/);
});

it("sends an explicit alternative reasoning effort", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).reasoning).toEqual({ effort: "low" });
    return sse(finish, final(usage));
  });
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "low", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence().status).toBe("complete");
});

it("omits reasoning for an explicitly non-reasoning model in Off mode", async () => {
  const plainModel = { ...model, reasoning: false };
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty("reasoning");
    expect(body).toMatchObject({ model: plainModel.id, max_completion_tokens: 128, provider: route });
    return sse(finish, final({ prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 }));
  });
  const { stream, evidence } = createOpenRouterTransport({ model: plainModel, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events.at(-1)?.type).toBe("done");
  expect(evidence()).toMatchObject({ status: "complete", usage: { output: 12, reasoning: 0 } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(() => createOpenRouterTransport({ model: plainModel, context, key: "test-secret",
    generation: { reasoning: "low", maxOutputTokens: 128 }, route, fetch })).toThrow("generation");
});

it("does not accept reported reasoning usage for a non-reasoning model", async () => {
  const plainModel = { ...model, reasoning: false };
  const fetch = vi.fn(async () => sse(finish, final(usage)));
  const { stream, evidence } = createOpenRouterTransport({ model: plainModel, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "usage_inconsistent" });
});

it("uses the SDK model's max_tokens compatibility field for the output cap", async () => {
  const compatibleModel = { ...model, compat: { maxTokensField: "max_tokens" as const } };
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    expect(body.max_tokens).toBe(128);
    expect(body).not.toHaveProperty("max_completion_tokens");
    return sse(finish, final(usage));
  });
  const { stream, evidence } = createOpenRouterTransport({ model: compatibleModel, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "complete", usage: { output: 12, reasoning: 4 } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects usage exceeding the requested max_tokens cap", async () => {
  const compatibleModel = { ...model, compat: { maxTokensField: "max_tokens" as const } };
  const fetch = vi.fn(async () => sse(finish, final({ prompt_tokens: 30, completion_tokens: 129, total_tokens: 159 })));
  const { stream, evidence } = createOpenRouterTransport({ model: compatibleModel, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "usage_inconsistent" });
});

it("retains routed identity but refuses a substituted model as complete", async () => {
  const fetch = vi.fn(async () => sse({ ...finish, model: "example/other-model" }, { ...final(usage), model: "example/other-model" }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events.at(-1)?.type).toBe("error");
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "model_mismatch", requestedModel: model.id,
    routedModel: "example/other-model", routedProvider: "test-provider" });
  expect(evidence().usage).toMatchObject({ input: 25, output: 12 }); // Evidence survives, but is not accepted as a complete priced call.
});

it.each([
  ["missing", undefined, "usage_missing"],
  ["partial", { prompt_tokens: 30 }, "usage_partial"],
  ["inconsistent", { ...usage, total_tokens: 41 }, "usage_inconsistent"],
  ["reasoning exceeds output", { ...usage, completion_tokens_details: { reasoning_tokens: 13 } }, "usage_inconsistent"],
])("refuses %s raw usage despite the SDK's normalized totals", async (_label, raw, reason) => {
  const fetch = vi.fn(async () => sse(finish, ...(raw ? [final(raw)] : [])));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(evidence()).toMatchObject({ status: "uncertain", reason });
  expect(events.at(-1)?.type).toBe("error");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects a truncated stream even if the SDK sees a finish reason and usage", async () => {
  const fetch = vi.fn(async () => new Response(`data: ${JSON.stringify(finish)}\n\ndata: ${JSON.stringify(final(usage))}\n\n`, { headers: { "content-type": "text/event-stream" } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "stream_incomplete" });
  expect(events.at(-1)?.type).toBe("error");
});

it("accepts explicit zero output usage without treating it as missing", async () => {
  const fetch = vi.fn(async () => sse({ ...finish, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    final({ prompt_tokens: 30, completion_tokens: 0, total_tokens: 30 })));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "complete", usage: { input: 30, output: 0, reasoning: 0 } });
});

it("keeps a reported total charge as evidence when the platform includes extra charges", async () => {
  const fetch = vi.fn(async () => sse({ ...finish, model: model.id }, { ...final(usage), model: model.id,
    usage: { ...usage, cost: 0.012, cost_details: { upstream_inference_cost: 0.01, other_charge: 0.002 } } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "complete", reportedCostUsd: 0.012 });
});

it("rejects unaccounted charge detail when no total charge is reported", async () => {
  const fetch = vi.fn(async () => sse({ ...finish, model: model.id }, { ...final(usage), model: model.id,
    usage: { ...usage, cost_details: { other_charge: 0.002 } } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "usage_inconsistent" });
});

it("rejects a reported total smaller than a charge detail", async () => {
  const fetch = vi.fn(async () => sse({ ...finish, model: model.id }, { ...final(usage), model: model.id,
    usage: { ...usage, cost: 0, cost_details: { other_charge: 0.002 } } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "usage_inconsistent" });
});

it("requires an explicit reasoning count when reasoning has a separate price", async () => {
  const fetch = vi.fn(async () => sse({ ...finish, model: model.id }, { ...final(usage), model: model.id,
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret",
    generation: { reasoning: "low", maxOutputTokens: 128 }, route, fetch, requireReasoningUsage: true });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "usage_partial" });
});

it("reports an HTTP provider failure without SDK retries or leaking the provider body", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "secret customer data" } }),
    { status: 503, headers: { "content-type": "application/json" } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "provider_error" });
  expect(JSON.stringify(evidence())).not.toMatch(/secret/);
});

it("records a bounded HTTP 400 diagnostic without retaining provider prose or secrets", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: {
    code: 400, message: "Unsupported parameter: store. private customer description; apiKey=do-not-save",
    metadata: { raw: "Bearer do-not-save" },
  } }), { status: 400, headers: { "content-type": "application/json" } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "private-key",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", reason: "provider_error", httpStatus: 400,
    providerErrorCategory: "unsupported_parameter", providerErrorField: "store" });
  expect(JSON.stringify(evidence())).not.toMatch(/private|customer|do-not-save|Bearer|apiKey/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves only OpenRouter's documented error type, never raw provider metadata", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400,
    message: "Private Quote text and apiKey=do-not-save", metadata: { error_type: "invalid_request", raw: "secret" },
  } }), { status: 400, headers: { "content-type": "application/json" } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "private-key",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", httpStatus: 400, providerErrorCategory: "invalid_request" });
  expect(JSON.stringify(evidence())).not.toMatch(/Private|Quote|do-not-save|secret/);
});

it("does not store unclassified provider messages even when an HTTP status is available", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Private customer description, apiKey=do-not-save" } }),
    { status: 400, headers: { "content-type": "application/json" } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "private-key",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  for await (const _event of stream) { /* consume */ }
  expect(evidence()).toMatchObject({ status: "uncertain", httpStatus: 400 });
  expect(evidence().providerErrorCategory).toBeUndefined();
  expect(JSON.stringify(evidence())).not.toMatch(/Private|customer|do-not-save/);
});

it("caps error inspection without stalling a large provider response", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "private".repeat(1000) } }),
    { status: 400, headers: { "content-type": "application/json" } }));
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "private-key",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  await Promise.race([
    (async () => { for await (const _event of stream) { /* consume */ } })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("error inspection stalled")), 1000)),
  ]);
  expect(evidence()).toMatchObject({ status: "uncertain", httpStatus: 400 });
  expect(JSON.stringify(evidence())).not.toContain("private");
});

it("records the HTTP status before a slow error body finishes", async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"error":{"message":"'));
      setTimeout(() => { controller.enqueue(new TextEncoder().encode('private"}}')); controller.close(); }, 450);
    },
  }), { status: 400, headers: { "content-type": "application/json" } });
  const fetch = vi.fn(async () => response);
  const { stream, evidence } = createOpenRouterTransport({ model, context, key: "private-key",
    generation: { reasoning: "off", maxOutputTokens: 128 }, route, fetch });
  const consume = (async () => { for await (const _event of stream) { /* consume */ } })();
  await new Promise((resolve) => setTimeout(resolve, 225));
  expect(evidence().httpStatus).toBe(400);
  await consume;
  expect(JSON.stringify(evidence())).not.toContain("private");
});

it("fails closed before HTTP when routing cannot enforce requested parameters", async () => {
  const fetch = vi.fn();
  expect(() => createOpenRouterTransport({ model, context, key: "test-secret", generation: { reasoning: "off", maxOutputTokens: 128 }, route: {}, fetch })).toThrow("routing");
  expect(fetch).not.toHaveBeenCalled();
});
