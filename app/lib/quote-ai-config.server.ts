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

function enabled(env: Environment): boolean {
  return env.QUOTE_AI_ENABLED === "true";
}

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required when QUOTE_AI_ENABLED=true.`);
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

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function fictionalIdentities(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,;]+/)
      .map((identity) => identity.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isFictionalQuoteAITest(env: Environment = process.env): boolean {
  return enabled(env) && env.QUOTE_AI_FICTIONAL_TEST_MODE === "true";
}

/** The auth boundary uses this in addition to its ordinary approved-email check. */
export function isFictionalTestIdentity(email: string, env: Environment = process.env): boolean {
  return fictionalIdentities(env.QUOTE_AI_FICTIONAL_TEST_IDENTITIES).has(email.trim().toLowerCase());
}

function assertLoopbackOrigin(value: string | undefined, name: string): void {
  const origins = (value ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!origins.length) throw new Error(`${name} must name a loopback HTTP origin in fictional test mode.`);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "http:" || !isLoopbackHost(url.hostname) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
    } catch {
      throw new Error(`${name} must name a loopback HTTP origin in fictional test mode.`);
    }
  }
}

function assertFictionalDatabase(value: string | undefined): void {
  try {
    const url = new URL(value ?? "");
    if (!(["postgres:", "postgresql:"].includes(url.protocol)) || !isLoopbackHost(url.hostname) ||
      !/^easy_quote_[a-z0-9_]*fictional$/.test(decodeURIComponent(url.pathname.slice(1))) || url.search || url.hash) {
      throw new Error();
    }
  } catch {
    throw new Error("DATABASE_URL must name a loopback PostgreSQL fictional database in fictional test mode.");
  }
}

function assertFictionalTestConfiguration(env: Environment): void {
  if (env.NODE_ENV === "production") {
    throw new Error("QUOTE_AI_FICTIONAL_TEST_MODE cannot run in production.");
  }
  if (env.QUOTE_AI_NO_TRAINING_CONFIRMED === "true") {
    throw new Error("QUOTE_AI_FICTIONAL_TEST_MODE must not assert QUOTE_AI_NO_TRAINING_CONFIRMED=true.");
  }
  if (env.QUOTE_AI_NO_TRAINING_CONFIRMED !== "false") {
    throw new Error("QUOTE_AI_NO_TRAINING_CONFIRMED=false is required in fictional test mode.");
  }
  required(env, "QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE");
  assertFictionalDatabase(env.DATABASE_URL);
  assertLoopbackOrigin(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  assertLoopbackOrigin(env.AUTH_TRUSTED_ORIGINS, "AUTH_TRUSTED_ORIGINS");

  const allowed = fictionalIdentities(env.AUTH_ALLOWED_EMAILS);
  const identities = fictionalIdentities(env.QUOTE_AI_FICTIONAL_TEST_IDENTITIES);
  if (!allowed.size || !identities.size || allowed.has("*") ||
    [...allowed].some((identity) => !identity.endsWith("@example.test")) ||
    allowed.size !== identities.size || [...allowed].some((identity) => !identities.has(identity))) {
    throw new Error("AUTH_ALLOWED_EMAILS must contain only explicit fictional test identities.");
  }
}

/**
 * Validates enabled outbound AI before requests can be made. This is pure and
 * makes no provider request, so it is safe to call during process startup.
 */
export function assertQuoteAIConfiguration(env: Environment = process.env): void {
  if (!enabled(env)) return;

  const provider = selectedProvider(env)[1];
  required(env, provider.credential);
  selectedModel(env);
  timeout(env);

  if (env.QUOTE_AI_FICTIONAL_TEST_MODE === "true") {
    assertFictionalTestConfiguration(env);
    return;
  }
  if (env.NODE_ENV !== "production") {
    throw new Error("Live Quote AI outside production requires QUOTE_AI_FICTIONAL_TEST_MODE=true.");
  }
  if (env.QUOTE_AI_NO_TRAINING_CONFIRMED !== "true") {
    throw new Error("QUOTE_AI_NO_TRAINING_CONFIRMED=true is required for production Quote AI.");
  }
  required(env, "QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE");
}

/**
 * Returns the server-owned model and bound pi stream function. It never reads
 * an endpoint from configuration and never falls back to a different model.
 */
export function configuredQuoteAI(env: Environment = process.env): QuoteAIConfiguration {
  assertQuoteAIConfiguration(env);
  if (!enabled(env)) throw new Error("Quote AI is disabled.");

  const { model, streamFn } = selectedModel(env);
  return { model, streamFn, timeoutMs: timeout(env) };
}

/** Returns safe server-to-browser information, never credentials or review references. */
export function quoteAIDisclosure(env: Environment = process.env): QuoteAIDisclosure {
  if (!enabled(env)) return { enabled: false, providerName: null, mode: "disabled" };

  const provider = selectedProvider(env)[1];
  return {
    enabled: true,
    providerName: provider.publicName,
    mode: env.QUOTE_AI_FICTIONAL_TEST_MODE === "true" ? "fictional-test" : "production-gated",
  };
}
