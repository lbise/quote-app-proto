import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { emptyQuote } from "../app/lib/quote";
import { generateQuoteChange } from "../app/lib/quote-assistant.server";
import { createLiveSession } from "./live";
import { resolveOpenRouterModel } from "./openrouter-models";
import { scenarios } from "./scenarios";

const id = "sample/plain-tools";
const entry = { id, name: "Plain tools", context_length: 65536,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "max_tokens"] };
const endpoint = { model_id: id, name: "Plain tools endpoint", provider_name: "Sample provider", status: 0,
  context_length: 65536, max_completion_tokens: 2048, supported_parameters: ["tools", "max_tokens"],
  pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000005", input_cache_write: "0.000001", request: "0.0001" } };
const metadata = (async (url: RequestInfo | URL) => String(url).endsWith("/endpoints")
  ? Response.json({ data: { id, endpoints: [endpoint] } }) : Response.json({ data: [entry] })) as typeof fetch;

it("reserves an OpenRouter tool turn before each real SDK request and retains model and price evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-openrouter-live-"));
  const resolved = await resolveOpenRouterModel(id, metadata);
  if (!resolved.model) throw new Error(resolved.reason);
  const models = createModels(); models.setProvider(openrouterProvider());
  const boundary = { model: resolved.model, timeoutMs: 10_000,
    streamFn: (model: Parameters<typeof models.streamSimple>[0], context: Parameters<typeof models.streamSimple>[1], options: Parameters<typeof models.streamSimple>[2]) => models.streamSimple(model, context, options) };
  const network = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const ledger = (await readFile(join(root, "live-sessions", `${live.id}.jsonl`), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(ledger.at(-1).call.status).toBe("reserved");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({ model: id, max_tokens: 128, provider: { require_parameters: true, allow_fallbacks: false } });
    const tool = network.mock.calls.length === 1;
    const chunks = [
      { id: `generation-${network.mock.calls.length}`, model: id, choices: [{ index: 0, delta: tool
        ? { tool_calls: [{ index: 0, id: "tool-1", type: "function", function: { name: "edit_quote_details", arguments: '{"fields":{"title":"Routed title"}}' } }] }
        : { content: "Saved." }, finish_reason: null }] },
      { id: `generation-${network.mock.calls.length}`, model: id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { id: `generation-${network.mock.calls.length}`, model: id, choices: [], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", network);
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
    maxCalls: 2, maxElapsedMs: 10_000, maxSpendUsd: 1, artifactRoot: root,
    generation: { reasoning: "off", maxOutputTokens: 128 }, openRouter: { resolution: resolved, apiKey: "only-for-test" } });
  try {
    const result = await generateQuoteChange({ quote: emptyQuote("EVAL-OR"), messages: [], text: "Set title", locale: "en" }, live.forRun(scenarios[0], boundary).boundary);
    expect(result.quote?.title).toBe("Routed title");
    expect(network).toHaveBeenCalledTimes(2);
    expect(live.calls).toMatchObject([{ status: "complete", usage: { input: 40, output: 10 } }, { status: "complete" }]);
    expect(live.pricing.source).toContain("openrouter.ai");
    expect(JSON.stringify(live.calls)).not.toContain("only-for-test");
  } finally { live.close(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});
