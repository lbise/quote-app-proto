import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";

import { resolveOpenRouterModel, type OpenRouterResolution } from "./openrouter-models.server";
import { conservativeBoundNanoUsd, openRouterNanoPricing } from "./openrouter-pricing.server";
import { createOpenRouterTransport, type OpenRouterEvidence } from "./openrouter-transport.server";
import { resolveQuoteAIGeneration, type QuoteAIGeneration, type QuoteAIGenerationOptions } from "./quote-ai-generation";
import type { QuoteAISpendLedger } from "./quote-ai-spend.server";

/** Pricing and capability metadata older than this is fetched again before a request. */
const resolutionTtlMs = 15 * 60_000;
const cache = new Map<string, { at: number; promise: Promise<OpenRouterResolution> }>();

/** Test hook. Production never needs to clear the cache. */
export function clearOpenRouterResolutionCache(): void { cache.clear(); }

function resolveCached(modelId: string, fetchFn: typeof fetch, now: number): Promise<OpenRouterResolution> {
  const hit = cache.get(modelId);
  if (hit && now - hit.at >= 0 && now - hit.at < resolutionTtlMs) return hit.promise;
  const promise = resolveOpenRouterModel(modelId, fetchFn).then((resolution) => {
    // Never keep a failure: the next request checks current metadata again.
    if (!resolution.available && cache.get(modelId)?.promise === promise) cache.delete(modelId);
    return resolution;
  });
  cache.set(modelId, { at: now, promise });
  return promise;
}

export type OpenRouterBoundaryOptions = {
  modelId: string;
  apiKey: string;
  timeoutMs: number;
  generation: QuoteAIGenerationOptions | undefined;
  spendLimitNanoUsd: number;
  ledger: QuoteAISpendLedger;
  fetch: typeof fetch;
  now: () => number;
};

export type OpenRouterBoundary = {
  model: Model<"openai-completions">;
  streamFn: StreamFn;
  timeoutMs: number;
  generation: QuoteAIGeneration;
  failure: () => string | undefined;
};

function errorMessage(model: Model<"openai-completions">, text: string): AssistantMessage {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], timestamp: Date.now(),
    stopReason: "error", errorMessage: text,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

/** Bounded diagnostic codes. Provider errors keep the generic request-failed diagnostic. */
function evidenceFailure(evidence: OpenRouterEvidence): string | undefined {
  return evidence.reason && evidence.reason !== "provider_error" ? `openrouter_${evidence.reason}` : undefined;
}

/**
 * Builds one request's production boundary for a server-configured OpenRouter
 * model. The exact model must resolve against current metadata; routing,
 * generation settings, and credential are pinned for every call, and each
 * call reserves its conservative price bound before anything is sent.
 */
export async function openRouterBoundary(options: OpenRouterBoundaryOptions): Promise<OpenRouterBoundary> {
  const { modelId, apiKey, ledger, spendLimitNanoUsd } = options;
  const resolution = await resolveCached(modelId, options.fetch, options.now());
  if (!resolution.available || !resolution.model || !resolution.pricing || !resolution.reasoning) {
    throw new Error(`OpenRouter model ${modelId} is unavailable: ${resolution.reason ?? "missing verified model, reasoning, or pricing metadata."}`);
  }
  const model = resolution.model as Model<"openai-completions">;
  const generation = resolveQuoteAIGeneration(model, options.generation);
  const price = openRouterNanoPricing(resolution);
  const reservation = conservativeBoundNanoUsd(generation.maxOutputTokens, price);
  const signature = JSON.stringify(model);
  let failure: string | undefined;
  const refuse = (code: string, text: string): never => { failure ??= code; throw new Error(text); };

  const streamFn: StreamFn = async (requestModel, context, streamOptions) => {
    if (JSON.stringify(requestModel) !== signature) refuse("model_changed", "The configured Quote AI model changed.");
    if (streamOptions?.maxTokens !== generation.maxOutputTokens || (streamOptions?.reasoning ?? "off") !== generation.reasoning) {
      refuse("invalid_generation_settings", "Quote AI generation settings changed.");
    }
    let reserved = false;
    try { reserved = await ledger.reserve(reservation, spendLimitNanoUsd); }
    catch { refuse("spend_ledger_unavailable", "The Quote AI spending ledger is unavailable."); }
    if (!reserved) refuse("spend_limit_reached", "The Quote AI spending limit has been reached.");

    let routed: ReturnType<typeof createOpenRouterTransport>;
    try {
      routed = createOpenRouterTransport({
        model, context, key: apiKey, generation, fetch: options.fetch,
        options: { signal: streamOptions?.signal, timeoutMs: streamOptions?.timeoutMs, onPayload: streamOptions?.onPayload },
        route: { require_parameters: true, allow_fallbacks: false },
        requireReasoningUsage: price.reasoningNanoUsd > 1,
      });
    } catch {
      // The reservation stays: a request may already have started.
      return refuse("openrouter_request_invalid", "OpenRouter request configuration is invalid.");
    }
    const stream = createAssistantMessageEventStream();
    void (async () => {
      try {
        for await (const event of routed.stream) {
          if (event.type === "error") {
            failure ??= evidenceFailure(routed.evidence());
            stream.push(event);
            break;
          }
          if (event.type === "done") {
            const evidence = routed.evidence();
            const usage = evidence.status === "complete" ? evidence.usage : undefined;
            if (!usage) {
              failure ??= evidenceFailure(evidence) ?? "openrouter_usage_missing";
              stream.push({ type: "error", reason: "error", error: errorMessage(model, "OpenRouter usage could not be verified.") });
              break;
            }
            const tokens = usage.input * price.inputNanoUsd + usage.output * price.outputNanoUsd
              + usage.cacheRead * price.cacheReadNanoUsd + usage.cacheWrite * price.cacheWriteNanoUsd
              + usage.reasoning * price.reasoningNanoUsd + price.requestNanoUsd;
            const reported = evidence.reportedCostUsd === undefined ? 0 : Math.ceil(evidence.reportedCostUsd * 1_000_000_000);
            const estimate = Math.max(tokens, reported);
            if (usage.input + usage.cacheRead + usage.cacheWrite > price.maxInputTokens || !Number.isSafeInteger(estimate) || estimate > reservation) {
              // Keep the whole reservation; the bound did not hold.
              failure ??= "openrouter_usage_exceeds_reservation";
              stream.push({ type: "error", reason: "error", error: errorMessage(model, "OpenRouter usage exceeded its reservation.") });
              break;
            }
            // Settle down to the verified estimate. A failed release only overstates spend.
            await ledger.release(reservation - estimate).catch(() => {});
          }
          stream.push(event);
        }
      } catch {
        failure ??= "openrouter_request_invalid";
        stream.push({ type: "error", reason: "error", error: errorMessage(model, "OpenRouter request failed.") });
      } finally {
        stream.end();
      }
    })();
    return stream;
  };
  return { model, streamFn, timeoutMs: options.timeoutMs, generation, failure: () => failure };
}
