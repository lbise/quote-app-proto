import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createLiveSession } from "./live";
import { resolveOpenRouterModel } from "./openrouter-models";
import { scenarios } from "./scenarios";

it("retains only a safe provider HTTP error category in the durable ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "eval-router-http-error-"));
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
  const network = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: "Private Quote details and apiKey=secret",
    metadata: { error_type: "invalid_request", raw: "Bearer secret" } } }), { status: 400, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", network);
  const live = createLiveSession({ modelBoundary: boundary, scenarios: [scenarios[0]], approvedProviderDataReview: true,
    maxCalls: 2, maxElapsedMs: 10_000, maxSpendUsd: 1, artifactRoot: root,
    generation: { reasoning: "off", maxOutputTokens: 128 }, openRouter: { resolution: resolved, apiKey: "private-key" } });
  try {
    const wrapped = live.forRun(scenarios[0], boundary).boundary;
    const stream = await wrapped.streamFn(boundary.model, { messages: [{ role: "user", content: "controlled input", timestamp: 1 }] });
    for await (const _event of stream) { /* consume */ }
    expect(live.calls).toMatchObject([{ status: "uncertain", httpStatus: 400, providerErrorCategory: "invalid_request" }]);
    expect(live.stopReason).toBe("provider_error");
    expect(network).toHaveBeenCalledTimes(1);
    const ledger = await readFile(join(root, "live-sessions", `${live.id}.jsonl`), "utf8");
    expect(ledger).toContain('"httpStatus":400');
    expect(ledger).not.toMatch(/Private|secret|Bearer|apiKey/);
  } finally { live.close(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});
