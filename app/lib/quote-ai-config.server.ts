import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";

import { isOpenRouterModelId } from "./openrouter-models.server";
import { quoteAIThinkingLevels, resolveQuoteAIGeneration, type QuoteAIGenerationOptions } from "./quote-ai-generation";
import type { QuoteAIDisclosure } from "./quote-ai-disclosure";
import { openRouterBoundary } from "./quote-ai-openrouter.server";
import { registeredProviders, type ProviderId } from "./quote-ai-providers.server";
import { deploymentSpendLedger, type QuoteAISpendLedger } from "./quote-ai-spend.server";
import { parseSpendUsd } from "./spend-usd";
import { assertTranscriptionConfiguration, transcriptionProviderName } from "./transcription.server";

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 45_000;

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;


export type QuoteAIConfiguration = {
  model: Model<Api>;
  streamFn: StreamFn;
  timeoutMs: number;
  /** Deployment-requested settings; validated against the model before any request. */
  generation?: QuoteAIGenerationOptions;
  failure?: () => string | undefined;
};

/** Server-side collaborators, injectable for tests. */
export type QuoteAIDependencies = {
  fetch?: typeof fetch;
  ledger?: QuoteAISpendLedger;
  now?: () => number;
};

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Quote AI.`);
  return value;
}

function timeout(env: Environment): number {
  const value = env.QUOTE_AI_TIMEOUT_MS;
  if (value === undefined || value === "") return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) {
    throw new Error("QUOTE_AI_TIMEOUT_MS must be an integer from 1000 through 45000.");
  }
  const parsed = Number(value);
  if (parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    throw new Error("QUOTE_AI_TIMEOUT_MS must be an integer from 1000 through 45000.");
  }
  return parsed;
}

/** Syntax only; support for a level or token limit depends on the model. */
function generation(env: Environment): QuoteAIGenerationOptions | undefined {
  const reasoning = env.QUOTE_AI_REASONING?.trim() || undefined;
  const maxOutputTokens = env.QUOTE_AI_MAX_OUTPUT_TOKENS?.trim() || undefined;
  if (reasoning !== undefined && !(quoteAIThinkingLevels as readonly string[]).includes(reasoning)) {
    throw new Error(`QUOTE_AI_REASONING must be one of ${quoteAIThinkingLevels.join(", ")}.`);
  }
  if (maxOutputTokens !== undefined && !/^[1-9]\d{0,6}$/.test(maxOutputTokens)) {
    throw new Error("QUOTE_AI_MAX_OUTPUT_TOKENS must be a positive integer.");
  }
  if (reasoning === undefined && maxOutputTokens === undefined) return undefined;
  return { ...(reasoning ? { reasoning } : {}), ...(maxOutputTokens ? { maxOutputTokens: Number(maxOutputTokens) } : {}) };
}

function spendLimitNanoUsd(env: Environment): number {
  const value = env.QUOTE_AI_SPEND_LIMIT_USD?.trim();
  if (!value) throw new Error("QUOTE_AI_SPEND_LIMIT_USD is required for OpenRouter Quote AI.");
  try { return parseSpendUsd(value).nanoUsd; }
  catch { throw new Error("QUOTE_AI_SPEND_LIMIT_USD must be a positive USD amount up to 1000000 with at most 9 decimal places."); }
}

function selectedProvider(env: Environment): ProviderId {
  const id = required(env, "QUOTE_AI_PROVIDER");
  if (!Object.hasOwn(registeredProviders, id)) throw new Error("QUOTE_AI_PROVIDER must name a registered provider.");
  return id as ProviderId;
}

function googleModel(env: Environment): { model: Model<Api>; streamFn: StreamFn } {
  const credential = required(env, registeredProviders.google.credential);
  const models = createModels();
  models.setProvider(googleProvider());
  const modelId = required(env, "QUOTE_AI_MODEL");
  const model = models.getModel("google", modelId);
  if (!model) throw new Error("QUOTE_AI_MODEL is not registered for provider google.");

  const streamFn: StreamFn = (model, context, options) =>
    models.streamSimple(model, context, {
      ...options,
      // The selected credential and provider environment win over process
      // state and Agent options. A request cannot drift to an ambient key.
      apiKey: credential,
      env: { GEMINI_API_KEY: credential },
    });
  return { model, streamFn };
}

function openRouterSettings(env: Environment) {
  const apiKey = required(env, registeredProviders.openrouter.credential);
  const modelId = required(env, "QUOTE_AI_MODEL");
  if (!isOpenRouterModelId(modelId)) throw new Error("QUOTE_AI_MODEL must be an exact OpenRouter model ID such as author/model.");
  return { apiKey, modelId, spendLimitNanoUsd: spendLimitNanoUsd(env) };
}

/**
 * Validates outbound AI before requests can be made. This is synchronous and
 * makes no provider request, so it is safe to call during process startup.
 * OpenRouter model metadata is checked before each request instead.
 */
export function assertQuoteAIConfiguration(env: Environment = process.env): void {
  const provider = selectedProvider(env);
  timeout(env);
  const requested = generation(env);
  if (provider === "openrouter") openRouterSettings(env);
  else resolveQuoteAIGeneration(googleModel(env).model, requested);
  assertTranscriptionConfiguration(env);
}

/**
 * Returns the server-owned model and bound stream function. It never reads an
 * endpoint from configuration and never falls back to a different provider,
 * model, route, or generation setting.
 */
export async function configuredQuoteAI(env: Environment = process.env, dependencies: QuoteAIDependencies = {}): Promise<QuoteAIConfiguration> {
  if (selectedProvider(env) === "google") return configuredGoogleQuoteAI(env);
  const timeoutMs = timeout(env);
  const requested = generation(env);
  const settings = openRouterSettings(env);
  const boundary = await openRouterBoundary({
    ...settings, timeoutMs, generation: requested,
    ledger: dependencies.ledger ?? deploymentSpendLedger(),
    fetch: dependencies.fetch ?? globalThis.fetch,
    now: dependencies.now ?? Date.now,
  });
  return boundary;
}

/**
 * Synchronous direct Google selection, for callers (such as the evaluator)
 * that choose Google explicitly. Generation settings are validated later,
 * against the requested settings of the caller.
 */
export function configuredGoogleQuoteAI(env: Environment = process.env): QuoteAIConfiguration {
  if (selectedProvider(env) !== "google") throw new Error("QUOTE_AI_PROVIDER must be google for this configuration.");
  const timeoutMs = timeout(env);
  const requested = generation(env);
  const { model, streamFn } = googleModel(env);
  return { model, streamFn, timeoutMs, ...(requested ? { generation: requested } : {}) };
}

/** Returns safe server-to-browser information, never credentials. */
export function quoteAIDisclosure(env: Environment = process.env): QuoteAIDisclosure {
  const transcription = transcriptionProviderName(env);
  return { providerName: registeredProviders[selectedProvider(env)].publicName, ...(transcription ? { transcriptionProviderName: transcription } : {}) };
}
