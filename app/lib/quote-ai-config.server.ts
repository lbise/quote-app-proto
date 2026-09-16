import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";

import type { QuoteAIDisclosure } from "./quote-ai-disclosure";

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 45_000;

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

type RegisteredProvider = {
  credential: string;
  publicName: string;
  create: () => ReturnType<typeof googleProvider>;
};

// Adding a provider requires an intentional registration here. Environment
// variables may select a registered catalog entry, never a custom endpoint.
const registeredProviders: Record<string, RegisteredProvider> = {
  google: {
    credential: "GEMINI_API_KEY",
    publicName: "Google Gemini Developer API",
    create: googleProvider,
  },
};

export type QuoteAIConfiguration = {
  model: Model<Api>;
  streamFn: StreamFn;
  timeoutMs: number;
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

function selectedProvider(env: Environment): [string, RegisteredProvider] {
  const id = required(env, "QUOTE_AI_PROVIDER");
  const provider = Object.hasOwn(registeredProviders, id) ? registeredProviders[id] : undefined;
  if (!provider) throw new Error("QUOTE_AI_PROVIDER must name a registered provider.");
  return [id, provider];
}

function selectedModel(env: Environment): { model: Model<Api>; streamFn: StreamFn } {
  const [providerId, provider] = selectedProvider(env);
  const credential = required(env, provider.credential);
  const models = createModels();
  models.setProvider(provider.create());
  const modelId = required(env, "QUOTE_AI_MODEL");
  const model = models.getModel(providerId, modelId);
  if (!model) throw new Error(`QUOTE_AI_MODEL is not registered for provider ${providerId}.`);

  const streamFn: StreamFn = (model, context, options) =>
    models.streamSimple(model, context, {
      ...options,
      // The selected credential and provider environment win over process
      // state and Agent options. A request cannot drift to an ambient key.
      apiKey: credential,
      env: { [provider.credential]: credential },
    });
  return { model, streamFn };
}

/**
 * Validates outbound AI before requests can be made. This is pure and makes no
 * provider request, so it is safe to call during process startup.
 */
export function assertQuoteAIConfiguration(env: Environment = process.env): void {
  selectedProvider(env);
  selectedModel(env);
  timeout(env);
}

/**
 * Returns the server-owned model and bound pi stream function. It never reads
 * an endpoint from configuration and never falls back to a different model.
 */
export function configuredQuoteAI(env: Environment = process.env): QuoteAIConfiguration {
  assertQuoteAIConfiguration(env);
  const { model, streamFn } = selectedModel(env);
  return { model, streamFn, timeoutMs: timeout(env) };
}

/** Returns safe server-to-browser information, never credentials. */
export function quoteAIDisclosure(env: Environment = process.env): QuoteAIDisclosure {
  const provider = selectedProvider(env)[1];
  return { providerName: provider.publicName };
}
