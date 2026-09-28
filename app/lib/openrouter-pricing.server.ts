import type { OpenRouterResolution } from "./openrouter-models.server";

/**
 * Integer nanodollars per token (and per request). Integer arithmetic avoids
 * rounding a cap up or releasing fractional reservations. Absent optional
 * categories cost nothing.
 */
export type NanoPricing = {
  maxInputTokens: number;
  maxOutputTokens: number;
  inputNanoUsd: number;
  outputNanoUsd: number;
  cacheReadNanoUsd?: number;
  cacheWriteNanoUsd?: number;
  requestNanoUsd?: number;
  reasoningNanoUsd?: number;
};

/**
 * Converts verified OpenRouter maxima into conservative integer rates. Each
 * rate rounds up and adds one nanodollar, so a zero-priced model still has a
 * positive, finite bound rather than being treated as free.
 */
export function openRouterNanoPricing(resolution: OpenRouterResolution): Required<NanoPricing> {
  if (!resolution.available || !resolution.model || !resolution.pricing || !resolution.endpoints.length) {
    throw new Error("OpenRouter model has no verified price and routing metadata.");
  }
  const { pricing: rates, model } = resolution;
  const nano = (rate: number) => {
    if (!Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(Math.ceil(rate * 1_000_000_000) + 1)) throw new Error("OpenRouter price is unbounded.");
    return Math.ceil(rate * 1_000_000_000) + 1;
  };
  return {
    maxInputTokens: model.contextWindow, maxOutputTokens: model.maxTokens,
    inputNanoUsd: nano(rates.maxInputUsdPerToken), outputNanoUsd: nano(rates.maxOutputUsdPerToken),
    cacheReadNanoUsd: nano(rates.maxCacheReadUsdPerToken), cacheWriteNanoUsd: nano(rates.maxCacheWriteUsdPerToken),
    requestNanoUsd: nano(rates.maxRequestUsd), reasoningNanoUsd: nano(rates.maxReasoningUsdPerToken),
  };
}

/**
 * The most one provider call can cost: a full context window at the highest
 * input or cache rate, every output token at output plus separate reasoning
 * rates, and the request fee. Refuses unpriced or unbounded requests.
 */
export function conservativeBoundNanoUsd(maxOutputTokens: number, price: NanoPricing): number {
  const inputRate = Math.max(price.inputNanoUsd, price.cacheReadNanoUsd ?? 0, price.cacheWriteNanoUsd ?? 0);
  const bound = price.maxInputTokens * inputRate + maxOutputTokens * (price.outputNanoUsd + (price.reasoningNanoUsd ?? 0)) + (price.requestNanoUsd ?? 0);
  if (!Number.isSafeInteger(bound) || bound <= 0) throw new Error("No usable conservative price bound for this model.");
  return bound;
}
