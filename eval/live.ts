import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { resolveQuoteAIGeneration, type QuoteAIGeneration, type QuoteAIGenerationOptions, type QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { scenarioHash } from "./scenario-hash";
import { createOpenRouterTransport, type OpenRouterEvidence } from "./openrouter-transport";
import type { OpenRouterResolution } from "./openrouter-models";
import { parseSpendUsd } from "./spend";
import type { LiveCall, LiveEvidence, Scenario } from "./types";

// Reviewed primary sources and SDK behavior: docs/research/evaluation-google-budget.md.
// Use the highest published text rate, even though this boundary cannot select Priority.
// Integer nanodollars avoid rounding up a user's cap or releasing fractional reservations.
const pricing: LiveEvidence["pricing"] = Object.freeze({
  id: "google-gemini-3.5-flash-lite-2026-09-22",
  checkedAt: "2026-09-22", expiresAt: "2026-09-29T00:00:00Z",
  source: "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite",
  inputNanoUsd: 540, outputNanoUsd: 4500, maxInputTokens: 1_048_576, maxOutputTokens: 4096,
});
export function assertLivePricing(): void {
  if (Date.now() < Date.parse(pricing.checkedAt) || Date.now() >= Date.parse(pricing.expiresAt)) throw new Error("Live pricing review has expired or is not yet valid. Recheck the documented Google rates and bounds.");
}
const usd = (nano: number) => nano / 1_000_000_000;
const googleThinkingLevel: Record<Exclude<QuoteAIGeneration["reasoning"], "off" | "xhigh" | "max">, string> = {
  minimal: "MINIMAL", low: "LOW", medium: "MEDIUM", high: "HIGH",
};
function reservationFor(generation: QuoteAIGeneration, price: LiveEvidence["pricing"]) {
  const inputRate = Math.max(price.inputNanoUsd, price.cacheReadNanoUsd ?? 0, price.cacheWriteNanoUsd ?? 0);
  const bound = price.maxInputTokens * inputRate + generation.maxOutputTokens * (price.outputNanoUsd + (price.reasoningNanoUsd ?? 0)) + (price.requestNanoUsd ?? 0);
  if (!Number.isSafeInteger(bound) || bound <= 0) throw new Error("No usable conservative price bound for this model.");
  return bound;
}
function openRouterPricing(resolution: OpenRouterResolution): LiveEvidence["pricing"] {
  if (!resolution.available || !resolution.model || !resolution.pricing || !resolution.endpoints.length) throw new Error("OpenRouter model has no verified price and routing metadata.");
  const { pricing: rates, model } = resolution;
  const nano = (rate: number) => {
    if (!Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(Math.ceil(rate * 1_000_000_000) + 1)) throw new Error("OpenRouter price is unbounded.");
    return Math.ceil(rate * 1_000_000_000) + 1;
  };
  return { id: `openrouter/${resolution.id}/${rates.checkedAt}`, checkedAt: rates.checkedAt,
    expiresAt: new Date(Date.parse(rates.checkedAt) + 15 * 60_000).toISOString(), source: rates.source,
    units: "nanodollars per token; request fee per call", routing: rates.routing,
    endpoints: structuredClone(resolution.endpoints), maxInputTokens: model.contextWindow, maxOutputTokens: model.maxTokens,
    inputNanoUsd: nano(rates.maxInputUsdPerToken), outputNanoUsd: nano(rates.maxOutputUsdPerToken),
    cacheReadNanoUsd: nano(rates.maxCacheReadUsdPerToken), cacheWriteNanoUsd: nano(rates.maxCacheWriteUsdPerToken),
    requestNanoUsd: nano(rates.maxRequestUsd), reasoningNanoUsd: nano(rates.maxReasoningUsdPerToken) };
}

function syncDirectoryTree(directory: string) {
  // A flushed file alone does not make its newly created directory entry durable.
  // Sync ancestors too, since --artifacts may name a previously nonexistent tree.
  for (let current = resolve(directory); ; current = dirname(current)) {
    const fd = openSync(current, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (dirname(current) === current) break;
  }
}

export type CreateLiveSessionOptions = {
  modelBoundary: QuoteAIModelBoundary;
  scenarios: Scenario[];
  approvedProviderDataReview: true;
  maxCalls: number;
  maxElapsedMs: number;
  maxSpendUsd: number;
  artifactRoot: string;
  /** Required for models that cannot genuinely disable reasoning. */
  generation?: QuoteAIGenerationOptions;
  openRouter?: { resolution: OpenRouterResolution; apiKey: string };
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unsupported live provider payload.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unsupported live provider payload field.");
}
function validatePayload(value: unknown, modelId: string, generation: QuoteAIGeneration) {
  const payload = record(value);
  keys(payload, ["model", "contents", "config"]);
  if (payload.model !== modelId || !Array.isArray(payload.contents)) throw new Error("Unsupported live provider request.");
  const config = record(payload.config);
  keys(config, ["maxOutputTokens", "temperature", "systemInstruction", "tools", "toolConfig", "thinkingConfig", "abortSignal", "candidateCount"]);
  if (config.maxOutputTokens !== generation.maxOutputTokens || config.candidateCount !== undefined && config.candidateCount !== 1
    || config.systemInstruction !== undefined && typeof config.systemInstruction !== "string") throw new Error("Unsupported live generation settings.");
  config.candidateCount = 1;
  const expectedThinkingLevel = googleThinkingLevel[generation.reasoning as keyof typeof googleThinkingLevel];
  if (!expectedThinkingLevel || config.thinkingConfig === undefined) throw new Error("Live evaluation requires explicit supported Gemini reasoning.");
  const thinking = record(config.thinkingConfig);
  keys(thinking, ["thinkingLevel", "includeThoughts"]);
  if (thinking.thinkingLevel !== expectedThinkingLevel || thinking.includeThoughts !== true) {
    throw new Error("Live generation reasoning did not reach Google as requested.");
  }
  if (config.tools !== undefined) {
    if (!Array.isArray(config.tools)) throw new Error("Unsupported live tools.");
    for (const tool of config.tools) {
      const item = record(tool);
      keys(item, ["functionDeclarations"]);
      if (!Array.isArray(item.functionDeclarations)) throw new Error("Only custom function tools are supported.");
    }
  }
  for (const content of payload.contents) {
    const item = record(content);
    keys(item, ["role", "parts"]);
    if (!Array.isArray(item.parts)) throw new Error("Unsupported live content.");
    for (const part of item.parts) {
      const block = record(part);
      keys(block, ["text", "thought", "thoughtSignature", "functionCall", "functionResponse"]);
      if (block.functionResponse !== undefined) keys(record(block.functionResponse), ["name", "id", "response"]);
      if (block.functionCall !== undefined) keys(record(block.functionCall), ["name", "id", "args"]);
    }
  }
}
const sdkTerminalStopReasons = new Set(["stop", "toolUse", "length", "error", "aborted", "deferred"]);
const googleFinishReason = /^[A-Z][A-Z0-9_]{0,63}$/;
function preserveTerminalReason(call: LiveCall, message: AssistantMessage) {
  if (sdkTerminalStopReasons.has(message.stopReason)) call.stopReason = message.stopReason;
  if (typeof message.rawStopReason === "string" && googleFinishReason.test(message.rawStopReason)) call.rawStopReason = message.rawStopReason;
}
function finalUsage(message: AssistantMessage, outputLimit: number): LiveCall["usage"] | undefined {
  const usage = message.usage;
  if (!["stop", "toolUse", "length"].includes(message.stopReason) || !usage) return;
  const counts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0) || usage.cacheWrite !== 0) return;
  const input = usage.input + usage.cacheRead;
  if (input <= 0 || input > pricing.maxInputTokens || usage.output > outputLimit
    || usage.totalTokens !== input + usage.output) return;
  return { input, output: usage.output, cacheRead: usage.cacheRead };
}

/** One explicit invocation's limits and approvals, shared across every case and repetition. */
export class LiveSession {
  readonly id = randomUUID();
  private readonly started = performance.now();
  private readonly approvedAt = new Date().toISOString();
  private readonly approved: Set<string>;
  private readonly modelSignature: string;
  private readonly _calls: LiveCall[] = [];
  private readonly generation: QuoteAIGeneration;
  private readonly reservation: number;
  private readonly price: LiveEvidence["pricing"];
  private readonly maxSpendNanoUsd: number;
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly ledger: string;
  private reserved = 0;
  private progressListener?: (calls: number, reservedUsd: number) => void;
  private reason: string | undefined;
  private closed = false;
  private readonly _limits: LiveEvidence["limits"];

  constructor(private readonly options: CreateLiveSessionOptions) {
    const { modelBoundary: { model }, maxCalls, maxElapsedMs, maxSpendUsd } = options;
    if (options.approvedProviderDataReview !== true || !options.scenarios.length) throw new Error("Explicit provider-data approval for selected scenarios is required.");
    if (options.scenarios.some(scenario => scenario.execution === "controlled-only")) throw new Error("Fault-injection scenarios are controlled-only.");
    if (options.scenarios.some(scenario => !scenario.steps.some(step => step.kind === "artisan"))) throw new Error("Each live scenario requires an Artisan message to evaluate the model.");
    const router = options.openRouter;
    if (router) {
      if (model.provider !== "openrouter" || model.api !== "openai-completions" || !router.apiKey
        || JSON.stringify(model) !== JSON.stringify(router.resolution.model) || router.resolution.id !== model.id) {
        throw new Error("OpenRouter resolution and configured provider/model do not match.");
      }
      this.price = openRouterPricing(router.resolution);
    } else {
      if (model.provider !== "google" || model.id !== "gemini-3.5-flash-lite" || model.api !== "google-generative-ai"
        || model.baseUrl !== "https://generativelanguage.googleapis.com/v1beta" || model.contextWindow !== 1_048_576 || model.maxTokens !== 65_536) {
        throw new Error("Live pricing supports only google/gemini-3.5-flash-lite at its registered Developer API endpoint.");
      }
      this.price = pricing;
    }
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 10_000
      || !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < 1 || maxElapsedMs > 3_600_000) {
      throw new Error("Live limits require 1–10000 calls, 1–3600000 ms, and positive USD with at most nine decimals, at most 1000000.");
    }
    this.maxSpendNanoUsd = parseSpendUsd(maxSpendUsd).nanoUsd;
    this.assertPricing();
    const requested = options.generation ?? options.modelBoundary.generation;
    if (router) {
      const supported = router.resolution.reasoning;
      const reasoning = requested?.reasoning ?? (supported?.offEstablished ? "off" : undefined);
      if (!reasoning || !supported || reasoning === "off" && !supported.offEstablished
        || reasoning !== "off" && !supported.supportedLevels.includes(reasoning)) {
        throw new Error("Choose a reasoning setting supported by the selected OpenRouter model; Off must be verified.");
      }
      const maxOutputTokens = requested?.maxOutputTokens ?? Math.min(4096, model.maxTokens);
      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > model.maxTokens) throw new Error("Unsupported OpenRouter output-token limit.");
      this.generation = { reasoning: reasoning as QuoteAIGeneration["reasoning"], maxOutputTokens };
    } else {
      this.generation = resolveQuoteAIGeneration(model, requested, true);
    }
    if (this.generation.maxOutputTokens > this.price.maxOutputTokens) {
      throw new Error(`Live pricing supports at most ${this.price.maxOutputTokens} output tokens per call.`);
    }
    this.reservation = reservationFor(this.generation, this.price);
    this._limits = { maxCalls, maxElapsedMs, maxSpendUsd };
    this.modelSignature = JSON.stringify(model);
    this.approved = new Set(options.scenarios.map(scenarioHash));
    const directory = join(options.artifactRoot, "live-sessions");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.ledger = join(directory, `${this.id}.jsonl`);
    writeFileSync(this.ledger, JSON.stringify({ sessionId: this.id, approvedAt: this.approvedAt, scenarioHashes: [...this.approved],
      provider: model.provider, model: model.id, generation: this.generation, pricing: this.price, limits: this._limits, perCallReservationUsd: usd(this.reservation) }) + "\n", { flag: "wx", mode: 0o600, flush: true });
    syncDirectoryTree(directory);
    this.timer = setTimeout(() => this.stop("elapsed_limit"), maxElapsedMs);
    this.timer.unref();
  }
  /** Settings that Agent and Google will receive for every evaluation call. */
  get effectiveGeneration(): Readonly<QuoteAIGeneration> { return { ...this.generation }; }
  get modelProvider() { return this.options.modelBoundary.model.provider; }
  get modelId() { return this.options.modelBoundary.model.id; }
  get pricing(): Readonly<LiveEvidence["pricing"]> { return structuredClone(this.price); }
  get limits(): Readonly<LiveEvidence["limits"]> { return { ...this._limits }; }
  get calls(): readonly LiveCall[] { return structuredClone(this._calls); }
  get stopReason() { return this.reason; }
  get stopped() { return this.reason; }
  onProgress(listener: (calls: number, reservedUsd: number) => void) { this.progressListener = listener; }
  private assertPricing() {
    if (!this.options.openRouter) { assertLivePricing(); return; }
    if (Date.now() < Date.parse(this.price.checkedAt) || Date.now() >= Date.parse(this.price.expiresAt)) {
      throw new Error("Live pricing metadata has expired or is not yet valid.");
    }
  }
  private log(value: unknown) {
    appendFileSync(this.ledger, JSON.stringify(value) + "\n", { mode: 0o600, flush: true });
  }
  private stop(reason: string) {
    this.reason ??= reason;
    this.controller.abort(this.reason);
  }
  cancel(reason = "cancelled") {
    if (typeof reason !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(reason)) throw new Error("Live cancellation reason must be a bounded lowercase code.");
    this.stop(reason);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.controller.abort("session_closed");
    this.log({ closedAt: new Date().toISOString(), stopReason: this.reason, calls: this._calls.length, reservedUsd: usd(this.reserved) });
  }
  forRun(scenario: Scenario, boundary: QuoteAIModelBoundary) {
    if (this.closed) throw new Error("Live session is closed.");
    const hash = scenarioHash(scenario);
    if (!this.approved.has(hash)) throw new Error("Provider-data approval does not cover this exact scenario version/hash.");
    if (JSON.stringify(boundary.model) !== this.modelSignature) throw new Error("The approved provider/model changed.");
    const first = this._calls.length;
    const evidence = (): LiveEvidence => ({ sessionId: this.id, approvedScenarioHashes: [...this.approved],
      approval: { at: this.approvedAt, scenarioHash: hash, provider: boundary.model.provider, model: boundary.model.id, method: "explicit-launch" },
      limits: { ...this._limits }, pricing: this.pricing, calls: structuredClone(this._calls.slice(first)),
      sessionCalls: this._calls.length, sessionReservedUsd: usd(this.reserved), ...(this.reason ? { stopReason: this.reason } : {}),
    });
    const wrapped: QuoteAIModelBoundary = { ...boundary, generation: this.generation, streamFn: (model, context, options) => {
      if (this.closed || this.reason) throw new Error("Live session stopped.");
      if (JSON.stringify(model) !== this.modelSignature) { this.stop("model_changed"); throw new Error("The approved provider/model changed."); }
      try { this.assertPricing(); } catch (error) { this.stop("pricing_expired"); throw error; }
      if (performance.now() - this.started >= this._limits.maxElapsedMs) this.stop("elapsed_limit");
      if (this._calls.length >= this._limits.maxCalls) this.stop("call_limit");
      if (this.reserved + this.reservation > this.maxSpendNanoUsd) this.stop("spend_limit");
      if (this.reason) throw new Error(`Live session stopped: ${this.reason}.`);
      // Reserve and fsync before invoking a transport, including retries of logical Artisan turns.
      const call: LiveCall = { number: this._calls.length + 1, reservedUsd: usd(this.reservation), status: "reserved", estimatedUsd: null };
      this._calls.push(call);
      this.reserved += this.reservation;
      try {
        this.log({ scenarioHash: hash, call });
        this.progressListener?.(this._calls.length, usd(this.reserved));
      } catch (error) { this.stop("ledger_write_failed"); throw error; }
      const stream = createAssistantMessageEventStream();
      const signal = AbortSignal.any([this.controller.signal, ...(options?.signal ? [options.signal] : [])]);
      let settled = false;
      const failed = (reason: string) => {
        if (settled) return;
        settled = true;
        call.status = "uncertain";
        this.stop(reason);
        const error: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: [], timestamp: Date.now(), stopReason: "error", errorMessage: `Live evaluation stopped: ${this.reason}.`,
          ...(call.rawStopReason ? { rawStopReason: call.rawStopReason } : {}),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "error", reason: "error", error });
        stream.end();
        try { this.log({ call, stopReason: this.reason }); } catch { /* Reservation was already durable; never release it. */ }
      };
      const aborted = () => failed(this.reason ?? "request_aborted");
      signal.addEventListener("abort", aborted, { once: true });
      void (async () => {
        try {
          if (signal.aborted) { aborted(); return; }
          let routerEvidence: (() => OpenRouterEvidence) | undefined;
          const upstreamOptions = { ...options, signal, maxTokens: this.generation.maxOutputTokens, maxRetries: 0, cacheRetention: "none" as const,
            reasoning: this.generation.reasoning === "off" ? undefined : this.generation.reasoning,
            onPayload: async (payload: unknown, requestModel: typeof model) => {
              if (!this.options.openRouter) validatePayload(payload, model.id, this.generation);
              // Preserve the production size guard, but allow inspection only.
              const before = JSON.stringify(payload);
              const payloadSignal = !this.options.openRouter ? record(record(payload).config).abortSignal : undefined;
              const next = await options?.onPayload?.(payload, requestModel);
              if (next !== undefined || JSON.stringify(payload) !== before || !this.options.openRouter && record(record(payload).config).abortSignal !== payloadSignal) {
                throw new Error("Live payload replacement or mutation is not supported.");
              }
              try { this.assertPricing(); } catch (error) { this.stop("pricing_expired"); throw error; }
              // SDK loading and synchronous ledger writes also consume the deadline.
              if (performance.now() - this.started >= this._limits.maxElapsedMs) this.stop("elapsed_limit");
              if (signal.aborted) throw new Error("Live request aborted before submission.");
            },
          };
          const router = this.options.openRouter;
          const routed = router ? createOpenRouterTransport({ model: model as typeof model & { api: "openai-completions" }, context,
            options: { signal, timeoutMs: options?.timeoutMs, onPayload: upstreamOptions.onPayload }, key: router.apiKey, generation: this.generation,
            route: { require_parameters: true, allow_fallbacks: false }, fetch: globalThis.fetch,
            requireReasoningUsage: (this.price.reasoningNanoUsd ?? 0) > 1 }) : undefined;
          routerEvidence = routed?.evidence;
          const upstream = routed?.stream ?? await boundary.streamFn(model, context, upstreamOptions);
          for await (const event of upstream) {
            if (settled) break;
            if (event.type === "error") {
              preserveTerminalReason(call, event.error);
              const routed = routerEvidence?.();
              if (routed?.routedModel) call.routedModel = routed.routedModel;
              if (routed?.routedProvider) call.routedProvider = routed.routedProvider;
              if (routed?.responseId) call.responseId = routed.responseId;
              if (routed?.reportedCostUsd !== undefined) call.reportedCostUsd = routed.reportedCostUsd;
              if (routed?.usage) call.usage = { input: routed.usage.input, output: routed.usage.output, cacheRead: routed.usage.cacheRead,
                cacheWrite: routed.usage.cacheWrite, reasoning: routed.usage.reasoning };
              failed(routed?.reason ?? "provider_error");
              break;
            }
            if (event.type === "done") {
              preserveTerminalReason(call, event.message);
              const routed = routerEvidence?.();
              const usage = routed ? routed.status === "complete" && routed.usage
                ? { input: routed.usage.input, output: routed.usage.output, cacheRead: routed.usage.cacheRead,
                    cacheWrite: routed.usage.cacheWrite, reasoning: routed.usage.reasoning }
                : undefined : finalUsage(event.message, this.generation.maxOutputTokens);
              if (!usage) { failed(routed?.reason ?? "usage_unavailable"); break; }
              if (routed?.routedModel) call.routedModel = routed.routedModel;
              if (routed?.routedProvider) call.routedProvider = routed.routedProvider;
              if (routed?.responseId) call.responseId = routed.responseId;
              if (routed?.reportedCostUsd !== undefined) call.reportedCostUsd = routed.reportedCostUsd;
              call.usage = usage;
              if (this.options.openRouter && usage.input + usage.cacheRead + (usage.cacheWrite ?? 0) > this.price.maxInputTokens) {
                failed("usage_exceeds_reservation"); break;
              }
              const tokenEstimate = usd(usage.input * this.price.inputNanoUsd + usage.output * this.price.outputNanoUsd
                + (this.options.openRouter ? usage.cacheRead * (this.price.cacheReadNanoUsd ?? this.price.inputNanoUsd) : 0)
                + (usage.cacheWrite ?? 0) * (this.price.cacheWriteNanoUsd ?? this.price.inputNanoUsd)
                + (usage.reasoning ?? 0) * (this.price.reasoningNanoUsd ?? 0) + (this.price.requestNanoUsd ?? 0));
              call.estimatedUsd = Math.max(tokenEstimate, routed?.reportedCostUsd ?? 0);
              if (routed?.reportedCostUsd !== undefined && Math.ceil(routed.reportedCostUsd * 1_000_000_000) > this.reservation) {
                failed("cost_exceeds_reservation"); break;
              }
              if (Math.ceil(call.estimatedUsd * 1_000_000_000) > this.reservation) {
                failed("usage_exceeds_reservation"); break;
              }
              call.status = "complete";
              this.log({ call });
              settled = true;
            }
            stream.push(event);
          }
          if (!settled) failed("stream_incomplete");
          stream.end();
        } catch { failed("provider_or_payload_error"); }
        finally { signal.removeEventListener("abort", aborted); }
      })();
      return stream;
    } };
    return { boundary: wrapped, evidence };
  }
}
export function createLiveSession(options: CreateLiveSessionOptions): LiveSession { return new LiveSession(options); }
