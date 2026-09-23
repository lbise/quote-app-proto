import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { configuredQuoteAI } from "../app/lib/quote-ai-config.server";
import { resolveOpenRouterModel, type OpenRouterResolution } from "./openrouter-models";

type Environment = Record<string, string | undefined>;
type Selection = { provider: string; modelId: string; environment: Environment; fetchFn?: typeof fetch };

/** Server-only selection shared by the evaluator entry points. Never serialize the returned key. */
export async function resolveEvaluationModel({ provider, modelId, environment, fetchFn }: Selection): Promise<{
  boundary: QuoteAIModelBoundary;
  openRouter?: { resolution: OpenRouterResolution; apiKey: string };
}> {
  if (provider === "google") {
    return { boundary: configuredQuoteAI({ QUOTE_AI_PROVIDER: provider, QUOTE_AI_MODEL: modelId,
      GEMINI_API_KEY: environment.GEMINI_API_KEY, QUOTE_AI_TIMEOUT_MS: environment.QUOTE_AI_TIMEOUT_MS }) };
  }
  if (provider !== "openrouter") throw new Error("Evaluation provider must name a registered provider: google or openrouter.");
  const apiKey = environment.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouter evaluation.");
  const rawTimeout = environment.QUOTE_AI_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout !== "" && (!/^\d+$/.test(rawTimeout) || Number(rawTimeout) < 1000 || Number(rawTimeout) > 45000)) {
    throw new Error("QUOTE_AI_TIMEOUT_MS must be an integer from 1000 through 45000.");
  }
  const resolution = await resolveOpenRouterModel(modelId, fetchFn);
  if (!resolution.available || !resolution.model || !resolution.pricing || !resolution.reasoning) {
    throw new Error(`OpenRouter model ${modelId} is unavailable: ${resolution.reason ?? "Missing verified model, reasoning, or pricing metadata."}`);
  }
  const models = createModels();
  models.setProvider(openrouterProvider());
  const boundary: QuoteAIModelBoundary = {
    model: resolution.model,
    timeoutMs: rawTimeout ? Number(rawTimeout) : 20_000,
    streamFn: (model, context, options) => models.streamSimple(model, context, {
      ...options, apiKey, env: { OPENROUTER_API_KEY: apiKey },
    }),
  };
  return { boundary, openRouter: { resolution, apiKey } };
}
