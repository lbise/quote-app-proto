import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { scenarioHash } from "./scenario-hash";
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
const reservation = pricing.maxInputTokens * pricing.inputNanoUsd + pricing.maxOutputTokens * pricing.outputNanoUsd;
const usd = (nano: number) => nano / 1_000_000_000;

function syncDirectoryTree(directory: string) {
  // A flushed file alone does not make its newly created directory entry durable.
  // Sync ancestors too, since --artifacts may name a previously nonexistent tree.
  for (let current = resolve(directory); ; current = dirname(current)) {
    const fd = openSync(current, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (dirname(current) === current) break;
  }
}

type Options = {
  modelBoundary: QuoteAIModelBoundary;
  scenarios: Scenario[];
  approvedProviderDataReview: true;
  maxCalls: number;
  maxElapsedMs: number;
  maxSpendUsd: number;
  artifactRoot: string;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unsupported live provider payload.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unsupported live provider payload field.");
}
function validatePayload(value: unknown, modelId: string) {
  const payload = record(value);
  keys(payload, ["model", "contents", "config"]);
  if (payload.model !== modelId || !Array.isArray(payload.contents)) throw new Error("Unsupported live provider request.");
  const config = record(payload.config);
  keys(config, ["maxOutputTokens", "temperature", "systemInstruction", "tools", "toolConfig", "thinkingConfig", "abortSignal", "candidateCount"]);
  if (config.maxOutputTokens !== 4096 || config.candidateCount !== undefined && config.candidateCount !== 1
    || config.systemInstruction !== undefined && typeof config.systemInstruction !== "string") throw new Error("Unsupported live generation settings.");
  config.candidateCount = 1;
  if (config.thinkingConfig !== undefined) {
    const thinking = record(config.thinkingConfig);
    keys(thinking, ["thinkingLevel", "includeThoughts"]);
    if (thinking.thinkingLevel !== "MINIMAL") throw new Error("Live evaluation requires minimal Gemini thinking.");
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
function finalUsage(message: AssistantMessage): LiveCall["usage"] | undefined {
  const usage = message.usage;
  if (!["stop", "toolUse", "length"].includes(message.stopReason) || !usage) return;
  const counts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  if (!counts.every(value => Number.isSafeInteger(value) && value >= 0) || usage.cacheWrite !== 0) return;
  const input = usage.input + usage.cacheRead;
  if (input <= 0 || input > pricing.maxInputTokens || usage.output > pricing.maxOutputTokens
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
  private readonly calls: LiveCall[] = [];
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly ledger: string;
  private reserved = 0;
  private reason: string | undefined;
  private closed = false;
  private readonly limits: LiveEvidence["limits"];

  constructor(private readonly options: Options) {
    const { modelBoundary: { model }, maxCalls, maxElapsedMs, maxSpendUsd } = options;
    if (options.approvedProviderDataReview !== true || !options.scenarios.length) throw new Error("Explicit provider-data approval for selected scenarios is required.");
    if (options.scenarios.some(scenario => scenario.execution === "controlled-only")) throw new Error("Fault-injection scenarios are controlled-only.");
    if (options.scenarios.some(scenario => !scenario.steps.some(step => step.kind === "artisan"))) throw new Error("Each live scenario requires an Artisan message to evaluate the model.");
    if (model.provider !== "google" || model.id !== "gemini-3.5-flash-lite" || model.api !== "google-generative-ai"
      || model.baseUrl !== "https://generativelanguage.googleapis.com/v1beta" || model.contextWindow !== 1_048_576 || model.maxTokens !== 65_536) {
      throw new Error("Live pricing supports only google/gemini-3.5-flash-lite at its registered Developer API endpoint.");
    }
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 10_000
      || !Number.isSafeInteger(maxElapsedMs) || maxElapsedMs < 1 || maxElapsedMs > 3_600_000
      || !Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0 || maxSpendUsd > 1_000_000 || !Number.isSafeInteger(maxSpendUsd * 1_000_000_000)) {
      throw new Error("Live limits require 1–10000 calls, 1–3600000 ms, and positive USD with at most nine decimals, at most 1000000.");
    }
    this.assertPricing();
    this.limits = { maxCalls, maxElapsedMs, maxSpendUsd };
    this.modelSignature = JSON.stringify(model);
    this.approved = new Set(options.scenarios.map(scenarioHash));
    const directory = join(options.artifactRoot, "live-sessions");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.ledger = join(directory, `${this.id}.jsonl`);
    writeFileSync(this.ledger, JSON.stringify({ sessionId: this.id, approvedAt: this.approvedAt, scenarioHashes: [...this.approved],
      provider: model.provider, model: model.id, pricing, limits: this.limits, perCallReservationUsd: usd(reservation) }) + "\n", { flag: "wx", mode: 0o600, flush: true });
    syncDirectoryTree(directory);
    this.timer = setTimeout(() => this.stop("elapsed_limit"), maxElapsedMs);
    this.timer.unref();
  }
  get stopped() { return this.reason; }
  private assertPricing() {
    if (Date.now() < Date.parse(pricing.checkedAt) || Date.now() >= Date.parse(pricing.expiresAt)) throw new Error("Live pricing review has expired or is not yet valid. Recheck the documented Google rates and bounds.");
  }
  private log(value: unknown) {
    appendFileSync(this.ledger, JSON.stringify(value) + "\n", { mode: 0o600, flush: true });
  }
  private stop(reason: string) {
    this.reason ??= reason;
    this.controller.abort(this.reason);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.controller.abort("session_closed");
    this.log({ closedAt: new Date().toISOString(), stopReason: this.reason, calls: this.calls.length, reservedUsd: usd(this.reserved) });
  }
  forRun(scenario: Scenario, boundary: QuoteAIModelBoundary) {
    if (this.closed) throw new Error("Live session is closed.");
    const hash = scenarioHash(scenario);
    if (!this.approved.has(hash)) throw new Error("Provider-data approval does not cover this exact scenario version/hash.");
    if (JSON.stringify(boundary.model) !== this.modelSignature) throw new Error("The approved provider/model changed.");
    const first = this.calls.length;
    const evidence = (): LiveEvidence => ({ sessionId: this.id, approvedScenarioHashes: [...this.approved],
      approval: { at: this.approvedAt, scenarioHash: hash, provider: boundary.model.provider, model: boundary.model.id, method: "explicit-launch" },
      limits: { ...this.limits }, pricing: { ...pricing }, calls: structuredClone(this.calls.slice(first)),
      sessionCalls: this.calls.length, sessionReservedUsd: usd(this.reserved), ...(this.reason ? { stopReason: this.reason } : {}),
    });
    const wrapped: QuoteAIModelBoundary = { ...boundary, streamFn: (model, context, options) => {
      if (this.closed || this.reason) throw new Error("Live session stopped.");
      if (JSON.stringify(model) !== this.modelSignature) { this.stop("model_changed"); throw new Error("The approved provider/model changed."); }
      try { this.assertPricing(); } catch (error) { this.stop("pricing_expired"); throw error; }
      if (performance.now() - this.started >= this.limits.maxElapsedMs) this.stop("elapsed_limit");
      if (this.calls.length >= this.limits.maxCalls) this.stop("call_limit");
      if (this.reserved + reservation > this.limits.maxSpendUsd * 1_000_000_000) this.stop("spend_limit");
      if (this.reason) throw new Error(`Live session stopped: ${this.reason}.`);
      // Reserve and fsync before invoking a transport, including retries of logical Artisan turns.
      const call: LiveCall = { number: this.calls.length + 1, reservedUsd: usd(reservation), status: "reserved", estimatedUsd: null };
      this.calls.push(call);
      this.reserved += reservation;
      try { this.log({ scenarioHash: hash, call }); } catch (error) { this.stop("ledger_write_failed"); throw error; }
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
          const upstream = await boundary.streamFn(model, context, { ...options, signal, maxTokens: 4096, maxRetries: 0, cacheRetention: "none", reasoning: undefined,
            onPayload: async (payload, requestModel) => {
              validatePayload(payload, model.id);
              // Preserve the production size guard, but allow inspection only.
              const before = JSON.stringify(payload);
              const payloadSignal = record(record(payload).config).abortSignal;
              const next = await options?.onPayload?.(payload, requestModel);
              if (next !== undefined || JSON.stringify(payload) !== before || record(record(payload).config).abortSignal !== payloadSignal) {
                throw new Error("Live payload replacement or mutation is not supported.");
              }
              try { this.assertPricing(); } catch (error) { this.stop("pricing_expired"); throw error; }
              // SDK loading and synchronous ledger writes also consume the deadline.
              if (performance.now() - this.started >= this.limits.maxElapsedMs) this.stop("elapsed_limit");
              if (signal.aborted) throw new Error("Live request aborted before submission.");
            },
          });
          for await (const event of upstream) {
            if (settled) break;
            if (event.type === "error") { failed("provider_error"); break; }
            if (event.type === "done") {
              const usage = finalUsage(event.message);
              if (!usage) { failed("usage_unavailable"); break; }
              call.usage = usage;
              call.estimatedUsd = usd(usage.input * pricing.inputNanoUsd + usage.output * pricing.outputNanoUsd);
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
export function createLiveSession(options: Options): LiveSession { return new LiveSession(options); }
