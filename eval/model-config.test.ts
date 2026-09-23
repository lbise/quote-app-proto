import { describe, expect, it } from "vitest";
import { resolveEvaluationModel } from "./model-config";

const id = "example/text-model";
const model = { id, name: "Text model", context_length: 8192,
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["tools", "max_tokens"] };
const endpoint = { name: "Provider A", model_id: id, provider_name: "Provider A", context_length: 8192,
  max_completion_tokens: 2048, supported_parameters: ["tools", "max_tokens"], status: 0,
  pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0", input_cache_write: "0" } };
function metadata(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input) === "https://openrouter.ai/api/v1/models") return Response.json({ data: [model] });
    if (String(input) === `https://openrouter.ai/api/v1/models/${id}/endpoints`) return Response.json({ data: { id, endpoints: [endpoint] } });
    throw new Error("Unexpected metadata request");
  }) as typeof fetch;
}

const googleEnvironment = { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "google-test-key" };

describe("evaluation model selection", () => {
  it("preserves the registered direct Google configuration without querying OpenRouter", async () => {
    const selected = await resolveEvaluationModel({ provider: "google", modelId: "gemini-3.5-flash-lite",
      environment: googleEnvironment, fetchFn: (() => { throw new Error("unexpected fetch"); }) as typeof fetch });
    expect(selected.boundary).toMatchObject({ model: { provider: "google", id: "gemini-3.5-flash-lite" }, timeoutMs: 20_000 });
    expect(selected.boundary.streamFn).toBeTypeOf("function");
    expect(selected.openRouter).toBeUndefined();
  });

  it("uses exact OpenRouter metadata and returns a server-only key for the live session", async () => {
    const selected = await resolveEvaluationModel({ provider: "openrouter", modelId: id,
      environment: { OPENROUTER_API_KEY: "router-test-key", QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "wrong", GEMINI_API_KEY: "other-key", QUOTE_AI_TIMEOUT_MS: "1000" }, fetchFn: metadata() });
    expect(selected.boundary).toMatchObject({ model: { provider: "openrouter", id, contextWindow: 8192 }, timeoutMs: 1000 });
    expect(selected.boundary.streamFn).toBeTypeOf("function");
    expect(selected.openRouter).toMatchObject({ resolution: { id, available: true }, apiKey: "router-test-key" });
    expect(JSON.stringify(selected.boundary)).not.toContain("router-test-key");
  });

  it("never falls back to Google or another credential when the OpenRouter key is missing", async () => {
    await expect(resolveEvaluationModel({ provider: "openrouter", modelId: id,
      environment: { GEMINI_API_KEY: "google-test-key" }, fetchFn: metadata() })).rejects.toThrow("OPENROUTER_API_KEY");
  });

  it("rejects unavailable exact IDs and unknown providers without substituting a model", async () => {
    await expect(resolveEvaluationModel({ provider: "openrouter", modelId: "example/absent",
      environment: { OPENROUTER_API_KEY: "router-test-key" }, fetchFn: metadata() })).rejects.toThrow(/not in.*listing/i);
    await expect(resolveEvaluationModel({ provider: "custom", modelId: id,
      environment: { OPENROUTER_API_KEY: "router-test-key" }, fetchFn: metadata() })).rejects.toThrow(/provider/i);
  });
});
