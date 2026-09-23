import type { Api, Model } from "@earendil-works/pi-ai";

const base = "https://openrouter.ai/api/v1";
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._~-]*\/[a-zA-Z0-9][a-zA-Z0-9._:~-]*$/;
const levels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const priceKeys = ["prompt", "completion", "input_cache_read", "input_cache_write", "internal_reasoning", "request"] as const;
// Public schemas: https://openrouter.ai/docs/api/api-reference/endpoints/list-all-endpoints-for-a-model
// Effort semantics: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
// The bundled pi catalog is transport plumbing, never evidence of current availability or price.

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
function positiveInt(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? value : null;
}
function rate(value: unknown): number | null {
  // OpenRouter prices are decimal USD per token/request, not pi's USD per million tokens.
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 && Number.isFinite(number * 1_000_000) ? number : null;
}

/** A listing is only a shortlist. `candidate` is NOT permission to run: resolve each ID before launch. */
export type OpenRouterListing = { models: { id: string; name: string; candidate: boolean; reason?: string }[]; error?: string };
export type OpenRouterEndpoint = { name: string; provider: string; contextWindow: number; maxTokens: number;
  supportedParameters: string[]; pricing: { inputUsdPerToken: number; outputUsdPerToken: number;
    cacheReadUsdPerToken: number; cacheWriteUsdPerToken: number; reasoningUsdPerToken: number; requestUsd: number;
    /** This endpoint did not publish cache charges. Only run with cacheRetention: 'none'. */
    requiresCacheRetentionNone: boolean } };
export type OpenRouterResolution = {
  id: string; available: boolean; reason?: string; model: Model<Api> | null;
  endpoints: OpenRouterEndpoint[];
  /** Only `supportedLevels` can be requested explicitly. Off must be sent as reasoning.effort='none' when established. */
  reasoning?: { supported: boolean; mandatory: boolean; offEstablished: boolean;
    requiresExplicitSelection: boolean; supportedLevels: string[] };
  pricing?: { source: string; checkedAt: string; unit: "USD/token";
    maxInputUsdPerToken: number; maxOutputUsdPerToken: number;
    maxCacheReadUsdPerToken: number; maxCacheWriteUsdPerToken: number; maxReasoningUsdPerToken: number;
    maxRequestUsd: number;
    /** Caller must enforce cacheRetention: 'none' on every request if true. */
    requiresCacheRetentionNone: boolean;
    /** pi model.cost.output includes both output and separate reasoning rates for a conservative cap. */
    routing: "any-published-endpoint" };
};
function failure(id: string, reason: string): OpenRouterResolution {
  return { id, available: false, model: null, reason, endpoints: [] };
}
function candidate(value: unknown): { id: string; name: string; candidate: boolean; reason?: string } {
  const data = object(value);
  const id = data?.id;
  const name = data?.name;
  const unavailable = (reason: string) => ({ id: typeof id === "string" ? id : "", name: typeof name === "string" ? name : "", candidate: false, reason });
  if (typeof id !== "string" || !idPattern.test(id) || typeof name !== "string" || !name.trim()) return unavailable("Invalid model ID or name in OpenRouter metadata.");
  const arch = object(data?.architecture);
  if (!strings(arch?.input_modalities)?.includes("text") || !strings(arch?.output_modalities)?.includes("text")) return unavailable("Text input and output are required.");
  if (!strings(data?.supported_parameters)?.includes("tools")) return unavailable("Custom tools are not supported by this model.");
  if (!positiveInt(data?.context_length)) return unavailable("Model context length is missing or invalid.");
  return { id, name, candidate: true };
}
async function json(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`OpenRouter metadata HTTP ${response.status} at ${url}.`);
  return response.json();
}
async function models(fetchFn: typeof fetch): Promise<unknown[]>{
  const data = object(await json(`${base}/models`, fetchFn));
  if (!Array.isArray(data?.data)) throw new Error("OpenRouter /models returned malformed data.");
  return data.data;
}

/** Fetches the public catalog without credentials. Failures appear in `error`; entries are unverified candidates until resolved. */
export async function discoverOpenRouterModels(fetchFn: typeof fetch = fetch): Promise<OpenRouterListing> {
  try { return { models: (await models(fetchFn)).map(candidate) }; }
  catch (error) { return { models: [], error: error instanceof Error ? error.message : "OpenRouter /models is unavailable." }; }
}

type EndpointPricing = OpenRouterEndpoint["pricing"];
function parsePricing(value: unknown, name: string, implicitCaching: unknown): { pricing?: EndpointPricing; reason?: string } {
  const price = object(value);
  if (!price) return { reason: `${name}: pricing is missing.` };
  const overrides = price.overrides === undefined ? [] : price.overrides;
  if (!Array.isArray(overrides)) return { reason: `${name}: pricing overrides are malformed.` };
  // Each override is conditional and inherits absent keys. Maxima over every entry
  // cover all possible thresholds and UTC windows, without trying to predict routing time.
  const maxima = Object.fromEntries(priceKeys.map(key => [key, 0])) as Record<(typeof priceKeys)[number], number>;
  for (const [index, row] of [price, ...overrides].entries()) {
    const tier = object(row);
    if (!tier) return { reason: `${name}: pricing overrides contain a malformed entry.` };
    for (const [key, amount] of Object.entries(tier)) {
      if (priceKeys.includes(key as (typeof priceKeys)[number])) {
        const parsed = rate(amount);
        if (parsed === null) return { reason: `${name}: pricing overrides or base ${key} rate is invalid.` };
        maxima[key as (typeof priceKeys)[number]] = Math.max(maxima[key as (typeof priceKeys)[number]], parsed);
      } else if (index > 0 && key === "min_prompt_tokens" && (!Number.isSafeInteger(amount) || (amount as number) < 0)) {
        return { reason: `${name}: pricing overrides contain an invalid threshold.` };
      } else if (index > 0 && (key === "utc_start" || key === "utc_end") && (!Number.isInteger(amount) || (amount as number) < 0 || (amount as number) > 2359)) {
        return { reason: `${name}: pricing overrides contain an invalid UTC window.` };
      } else if (index > 0 && key === "utc_days" && (!Array.isArray(amount) || !amount.length || amount.some(v => !["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(v)))) {
        return { reason: `${name}: pricing overrides contain invalid UTC days.` };
      } else if (index === 0 && key === "discount") {
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 1) return { reason: `${name}: invalid pricing discount.` };
        // A discount can only lower the published base rate; use the undiscounted rate.
      } else if (index === 0 && key === "overrides") {
        // Handled above.
      } else if (index > 0 && ["min_prompt_tokens", "utc_days", "utc_start", "utc_end"].includes(key)) {
        // Maximize all tiers regardless of their conditions.
      } else if (index === 0 && rate(amount) === 0) {
        // An unused charge category explicitly priced at zero is safe.
      } else {
        return { reason: `${name}: pricing overrides or ${key} charge cannot be bounded.` };
      }
    }
  }
  if (rate(price.prompt) === null || rate(price.completion) === null) return { reason: `${name}: prompt/completion price is missing or invalid.` };
  const missingRead = price.input_cache_read === undefined;
  const missingWrite = price.input_cache_write === undefined;
  if ((missingRead || missingWrite) && implicitCaching !== false) return { reason: `${name}: cache rates are missing and implicit caching cannot be ruled out.` };
  // Without implicit caching, cacheRetention:none must be enforced at launch. A
  // cache read is conservatively charged as regular input, never as a discount.
  const input = maxima.prompt;
  return { pricing: { inputUsdPerToken: input, outputUsdPerToken: maxima.completion,
    cacheReadUsdPerToken: missingRead ? Math.max(input, maxima.input_cache_read) : maxima.input_cache_read,
    cacheWriteUsdPerToken: maxima.input_cache_write,
    reasoningUsdPerToken: maxima.internal_reasoning, requestUsd: maxima.request,
    requiresCacheRetentionNone: missingRead || missingWrite } };
}

function parseEndpoint(value: unknown, id: string): { endpoint?: OpenRouterEndpoint; reason?: string } {
  const data = object(value);
  const name = data?.name;
  if (typeof name !== "string" || !name.trim() || data?.model_id !== id) return { reason: "Endpoint name or model ID is missing/mismatched." };
  const parameters = strings(data?.supported_parameters);
  if (!parameters?.includes("tools")) return { reason: `${name}: custom tools are not supported.` };
  if (!parameters.includes("max_tokens") && !parameters.includes("max_completion_tokens")) return { reason: `${name}: output token limit is not supported.` };
  if (!positiveInt(data?.context_length) || !positiveInt(data?.max_completion_tokens)) return { reason: `${name}: context or completion token bound is missing.` };
  if (data?.status !== 0) return { reason: `${name}: endpoint is unavailable or status is unknown.` };
  const parsed = parsePricing(data?.pricing, name, data?.supports_implicit_caching);
  if (!parsed.pricing) return { reason: parsed.reason };
  return { endpoint: { name, provider: typeof data.provider_name === "string" ? data.provider_name : name,
    contextWindow: data.context_length as number, maxTokens: data.max_completion_tokens as number,
    supportedParameters: parameters, pricing: parsed.pricing } };
}

/**
 * Resolve before launching. Never pins routing: every advertised endpoint must be safe, priced, and bounded.
 * The caller must enforce `pricing.requiresCacheRetentionNone`, validate requested reasoning against
 * `reasoning.supportedLevels`/`offEstablished`, reserve `maxRequestUsd` plus input/cache rates
 * and `maxOutputUsdPerToken + maxReasoningUsdPerToken` per output token, and refresh before
 * launch. Metadata is not a guarantee against future platform changes.
 */
export async function resolveOpenRouterModel(id: string, fetchFn: typeof fetch = fetch): Promise<OpenRouterResolution> {
  if (!idPattern.test(id)) return failure(id, "Invalid OpenRouter model ID; expected author/model.");
  const source = `${base}/models/${id.split("/").map(encodeURIComponent).join("/")}/endpoints`;
  try {
    const found = (await models(fetchFn)).find(value => object(value)?.id === id);
    if (!found) return failure(id, "Model is not in the current OpenRouter /models listing.");
    const entry = candidate(found);
    if (!entry.candidate) return failure(id, entry.reason!);
    const raw = object(found)!;
    const advertisedReasoning = object(raw.reasoning);
    const modelHasReasoningParameter = strings(raw.supported_parameters)?.includes("reasoning") === true;
    const response = object(await json(source, fetchFn));
    const data = object(response?.data);
    if (data?.id !== id || !Array.isArray(data.endpoints) || !data.endpoints.length) return failure(id, "No verified endpoints for this model.");
    const endpoints: OpenRouterEndpoint[] = [];
    for (const item of data.endpoints) {
      const parsed = parseEndpoint(item, id);
      if (!parsed.endpoint) return failure(id, parsed.reason ?? "Malformed endpoint metadata.");
      endpoints.push(parsed.endpoint);
    }
    // OpenRouter documents supported_efforts as the gateway's model-level allowlist;
    // endpoints expose only parameter support. An endpoint that cannot pass `reasoning`
    // makes that choice unsafe without pinning a route (which we do not do).
    const reasoningSupported = advertisedReasoning !== null || modelHasReasoningParameter ||
      endpoints.some(e => e.supportedParameters.includes("reasoning"));
    const mandatory = advertisedReasoning?.mandatory === true;
    const efforts = advertisedReasoning?.supported_efforts === null ? ["none", ...levels]
      : strings(advertisedReasoning?.supported_efforts);
    const validEfforts = efforts !== null && efforts.every(e => e === "none" || levels.includes(e as typeof levels[number]));
    const allEndpointsSupportReasoning = endpoints.every(e => e.supportedParameters.includes("reasoning"));
    const supportedLevels = validEfforts ? levels.filter(level => efforts.includes(level)) : [];
    const offEstablished = reasoningSupported ? !mandatory && validEfforts && efforts.includes("none") : true;
    const reasoning = { supported: reasoningSupported, mandatory, offEstablished,
      requiresExplicitSelection: !offEstablished, supportedLevels: [...supportedLevels] };
    if (reasoningSupported && (!advertisedReasoning || typeof advertisedReasoning.mandatory !== "boolean" || !validEfforts ||
        !modelHasReasoningParameter || !allEndpointsSupportReasoning || (!offEstablished && !supportedLevels.length))) {
      const unsupportedEndpoint = endpoints.find(e => !e.supportedParameters.includes("reasoning"));
      return { ...failure(id, unsupportedEndpoint
        ? `${unsupportedEndpoint.name}: reasoning parameter is not supported across routed endpoints.`
        : "Reasoning Off or effort support is not established; check model supported_efforts and reasoning parameters."), reasoning, endpoints };
    }
    if (mandatory && offEstablished) return { ...failure(id, "Mandatory reasoning cannot support Off."), reasoning, endpoints };
    const max = (get: (endpoint: OpenRouterEndpoint) => number) => Math.max(...endpoints.map(get));
    const contextWindow = Math.min(raw.context_length as number, ...endpoints.map(e => e.contextWindow));
    const maxTokens = Math.min(...endpoints.map(e => e.maxTokens));
    const input = max(e => e.pricing.inputUsdPerToken), output = max(e => e.pricing.outputUsdPerToken);
    const cacheRead = max(e => e.pricing.cacheReadUsdPerToken), cacheWrite = max(e => e.pricing.cacheWriteUsdPerToken);
    const request = max(e => e.pricing.requestUsd);
    const reasoningRate = max(e => e.pricing.reasoningUsdPerToken);
    const requiresCacheRetentionNone = endpoints.some(e => e.pricing.requiresCacheRetentionNone);
    const maxTokensField = endpoints.every(e => e.supportedParameters.includes("max_tokens")) ? "max_tokens"
      : endpoints.every(e => e.supportedParameters.includes("max_completion_tokens")) ? "max_completion_tokens" : null;
    if (!maxTokensField) return failure(id, "Endpoints disagree on the supported output token limit parameter; routing cannot preserve the limit.");
    const model: Model<Api> = { id, name: entry.name, provider: "openrouter", api: "openai-completions", baseUrl: base,
      reasoning: reasoningSupported, input: ["text"], contextWindow, maxTokens,
      ...(reasoningSupported ? { thinkingLevelMap: Object.fromEntries(["off", ...levels].map(level =>
        [level, level === "off" ? offEstablished ? "none" : null : supportedLevels.includes(level as typeof levels[number]) ? level : null])) } : {}),
      cost: { input: input * 1_000_000, output: (output + reasoningRate) * 1_000_000,
        cacheRead: cacheRead * 1_000_000, cacheWrite: cacheWrite * 1_000_000 },
      compat: { thinkingFormat: "openrouter", supportsDeveloperRole: false, maxTokensField } };
    return { id, available: true, model, endpoints, reasoning,
      pricing: { source, checkedAt: new Date().toISOString(), unit: "USD/token", maxInputUsdPerToken: input,
        maxOutputUsdPerToken: output, maxCacheReadUsdPerToken: cacheRead, maxCacheWriteUsdPerToken: cacheWrite,
        maxReasoningUsdPerToken: reasoningRate, maxRequestUsd: request, requiresCacheRetentionNone,
        routing: "any-published-endpoint" } };
  } catch (error) { return failure(id, error instanceof Error ? error.message : "OpenRouter metadata request failed."); }
}
