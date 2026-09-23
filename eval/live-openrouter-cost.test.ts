import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createLiveSession } from "./live";
import { resolveOpenRouterModel } from "./openrouter-models";
import { scenarios } from "./scenarios";

it.each([{ caseName: "reported charge", prompt: 20, cost: 1, stopReason: "cost_exceeds_reservation" },
  { caseName: "unbounded input count", prompt: 65537, cost: undefined, stopReason: "usage_exceeds_reservation" }])
  ("stops before another OpenRouter request on $caseName", async ({ prompt, cost, stopReason }) => {
  const root = await mkdtemp(join(tmpdir(), "eval-router-cost-"));
  const id = "sample/priced-tools";
  const metadata = (async (url: RequestInfo | URL) => String(url).endsWith("/endpoints")
    ? Response.json({ data: { id, endpoints: [{ name: "Provider", model_id: id, provider_name: "Provider", status: 0,
      context_length: 65536, max_completion_tokens: 2048, supported_parameters: ["tools", "max_tokens"], supports_implicit_caching: false,
      pricing: { prompt: "0.000001", completion: "0.000002", request: "0.0001" } }] } })
    : Response.json({ data: [{ id, name: "Priced tools", context_length: 65536,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools", "max_tokens"] }] })) as typeof fetch;
  const resolved = await resolveOpenRouterModel(id, metadata);
  if (!resolved.model) throw new Error(resolved.reason);
  const models = createModels(); models.setProvider(openrouterProvider());
  const boundary = { model: resolved.model, timeoutMs: 10_000,
    streamFn: (model: Parameters<typeof models.streamSimple>[0], context: Parameters<typeof models.streamSimple>[1], options: Parameters<typeof models.streamSimple>[2]) => models.streamSimple(model, context, options) };
  const network = vi.fn(async () => new Response(`data: ${JSON.stringify({ id: "generation", model: id, choices: [{ index: 0, delta: { content: "Done" }, finish_reason: "stop" }] })}\n\ndata: ${JSON.stringify({ id: "generation", model: id, choices: [], usage: {
    prompt_tokens: prompt, completion_tokens: 1, total_tokens: prompt + 1, ...(cost === undefined ? {} : { cost }) } })}\n\ndata: [DONE]\n\n`,
  { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", network);
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
    maxCalls: 2, maxElapsedMs: 10_000, maxSpendUsd: 2, artifactRoot: root,
    generation: { reasoning: "off", maxOutputTokens: 128 }, openRouter: { resolution: resolved, apiKey: "private-key" } });
  try {
    const wrapped = live.forRun(scenarios[0], boundary).boundary;
    const context = { messages: [{ role: "user" as const, content: "controlled input", timestamp: 1 }] };
    const stream = await wrapped.streamFn(boundary.model, context);
    for await (const _event of stream) { /* consume */ }
    expect(live.calls).toMatchObject([{ status: "uncertain", usage: { input: prompt, output: 1 } }]);
    expect(live.stopReason).toBe(stopReason);
    if (cost !== undefined) expect(live.calls[0]).toMatchObject({ reportedCostUsd: 1, estimatedUsd: 1 });
    expect(() => wrapped.streamFn(boundary.model, context)).toThrow("Live session stopped");
    expect(network).toHaveBeenCalledTimes(1);
  } finally { live.close(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});
