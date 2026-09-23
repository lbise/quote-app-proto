import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type OpenRouterRouting, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { QuoteAIGeneration } from "../app/lib/quote-assistant.server";

export type OpenRouterEvidence = {
  status: "pending" | "complete" | "uncertain";
  requestedModel: string;
  routedModel?: string;
  routedProvider?: string;
  responseId?: string;
  /** OpenRouter's reported request total, when present. It may include charges beyond token rates. */
  reportedCostUsd?: number;
  httpStatus?: number;
  /** Only fixed categories and known parameter names are retained, never provider prose. */
  providerErrorCategory?: "unsupported_parameter" | "no_compatible_endpoint" | "invalid_request" | "invalid_prompt" | "context_length_exceeded" | "string_too_long";
  providerErrorField?: string;
  stopReason?: string;
  reason?: "usage_missing" | "usage_partial" | "usage_inconsistent" | "stream_incomplete" | "provider_error" | "request_invalid" | "model_mismatch";
  /** Reasoning tokens are included in output, not an additional output charge. */
  usage?: { input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number; totalTokens: number };
};

export type OpenRouterTransportRequest = {
  model: Model<"openai-completions">;
  context: Context;
  options?: SimpleStreamOptions;
  key: string;
  generation: QuoteAIGeneration;
  route: OpenRouterRouting;
  fetch: typeof globalThis.fetch;
  /** Separate reasoning charges cannot be estimated without a reported count. */
  requireReasoningUsage?: boolean;
};

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const identity = (value: unknown): value is string => typeof value === "string" && /^[\w./:@-]{1,128}$/.test(value);

function usageFrom(raw: unknown, maxOutputTokens: number, requireReasoningUsage: boolean): Pick<OpenRouterEvidence, "usage" | "reason" | "reportedCostUsd"> {
  if (!object(raw)) return { reason: "usage_missing" };
  if (![raw.prompt_tokens, raw.completion_tokens, raw.total_tokens].every(count)) return { reason: "usage_partial" };
  const prompt = raw.prompt_tokens as number;
  const output = raw.completion_tokens as number;
  const total = raw.total_tokens as number;
  const promptDetails = raw.prompt_tokens_details;
  const completionDetails = raw.completion_tokens_details;
  if (promptDetails !== undefined && !object(promptDetails) || completionDetails !== undefined && !object(completionDetails)) return { reason: "usage_partial" };
  const cacheRead = (promptDetails as ObjectValue | undefined)?.cached_tokens ?? raw.cached_tokens ?? 0;
  const cacheWrite = (promptDetails as ObjectValue | undefined)?.cache_write_tokens ?? 0;
  if (requireReasoningUsage && !count((completionDetails as ObjectValue | undefined)?.reasoning_tokens)) return { reason: "usage_partial" };
  const reasoning = (completionDetails as ObjectValue | undefined)?.reasoning_tokens ?? 0;
  if (![cacheRead, cacheWrite, reasoning].every(count) || prompt < (cacheRead as number) + (cacheWrite as number)
    || output > maxOutputTokens || (reasoning as number) > output || total !== prompt + output) return { reason: "usage_inconsistent" };
  // Audio, images, and unrecognized billable counts cannot be priced by this transport.
  const known = (value: ObjectValue, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
  if (!known(raw, ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_tokens_details", "completion_tokens_details", "cached_tokens", "cost", "cost_details"])
    || promptDetails && !known(promptDetails as ObjectValue, ["cached_tokens", "cache_write_tokens"])
    || completionDetails && !known(completionDetails as ObjectValue, ["reasoning_tokens"])) return { reason: "usage_inconsistent" };
  const reportedCost = raw.cost === undefined || raw.cost === null ? undefined : Number(raw.cost);
  if (raw.cost !== undefined && raw.cost !== null && (typeof raw.cost !== "string" && typeof raw.cost !== "number"
    || !Number.isFinite(reportedCost) || reportedCost! < 0)) return { reason: "usage_inconsistent" };
  if (raw.cost_details !== undefined && raw.cost_details !== null) {
    if (!object(raw.cost_details) || Object.values(raw.cost_details).some(value =>
      typeof value !== "number" && typeof value !== "string" || !Number.isFinite(Number(value)) || Number(value) < 0)) return { reason: "usage_inconsistent" };
    if (Object.values(raw.cost_details).some(value => reportedCost === undefined ? Number(value) > 0 : Number(value) > reportedCost)) {
      return { reason: "usage_inconsistent" };
    }
  }
  return { ...(reportedCost !== undefined ? { reportedCostUsd: reportedCost } : {}),
    usage: { input: prompt - (cacheRead as number) - (cacheWrite as number), cacheRead: cacheRead as number,
      cacheWrite: cacheWrite as number, output, reasoning: reasoning as number, totalTokens: total } };
}

const safeErrorFields = new Set(["store", "strict", "tools", "reasoning", "max_tokens", "max_completion_tokens", "tool_choice", "provider", "stream_options"]);
/** Keep only a bounded, structured HTTP diagnostic. Provider prose can echo keys or Quote content. */
async function inspectErrorResponse(response: Response, evidence: OpenRouterEvidence, signal: AbortSignal) {
  if (response.status < 400 || response.status > 599) return;
  if (!response.headers.get("content-type")?.includes("application/json")) return;
  const reader = response.clone().body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // A tee branch's cancel may wait for the SDK to consume the original branch.
      if (size > 4096) { cancel(); return; }
      chunks.push(value);
    }
    const raw = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
    if (signal.aborted) return;
    const body: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!object(body) || !object(body.error) || typeof body.error.message !== "string") return;
    const metadata = body.error.metadata;
    const typedError = object(metadata) ? metadata.error_type : undefined;
    if (["invalid_request", "invalid_prompt", "context_length_exceeded", "string_too_long"].includes(String(typedError))) {
      evidence.providerErrorCategory = typedError as NonNullable<OpenRouterEvidence["providerErrorCategory"]>;
    }
    const message = body.error.message.slice(0, 256);
    const parameter = /^unsupported (?:request )?parameter:?\s*["'`]?([a-z_]+)\b/i.exec(message);
    if (parameter && safeErrorFields.has(parameter[1].toLowerCase())) {
      evidence.providerErrorCategory = "unsupported_parameter";
      evidence.providerErrorField = parameter[1].toLowerCase();
    } else if (/^no (?:endpoints?|providers?) (?:found|available) (?:that |which )?(?:support|match)/i.test(message)) {
      evidence.providerErrorCategory = "no_compatible_endpoint";
    }
  } catch { /* HTTP status still survives; never store or log the provider body. */ }
  finally { signal.removeEventListener("abort", cancel); }
}

/** An SSE observer on the injected HTTP boundary. It retains counts and bounded identities, never content or headers. */
function observe(response: Response, state: { done: boolean; usage?: unknown; usageCount: number; routedModel?: string; routedProvider?: string; responseId?: string; invalid: boolean }): Response {
  if (!response.body) return response;
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const event = () => {
    if (!data.length) return;
    const text = data.join("\n");
    data = [];
    if (text === "[DONE]") { if (state.done) state.invalid = true; state.done = true; return; }
    if (state.done) state.invalid = true;
    try {
      const chunk: unknown = JSON.parse(text);
      if (!object(chunk)) { state.invalid = true; return; }
      for (const [field, target] of [["model", "routedModel"], ["provider", "routedProvider"], ["id", "responseId"]] as const) {
        if (chunk[field] !== undefined) {
          if (!identity(chunk[field])) { state.invalid = true; continue; }
          const previous = state[target];
          if (previous && previous !== chunk[field]) state.invalid = true;
          else state[target] = chunk[field];
        }
      }
      if (chunk.usage !== undefined && chunk.usage !== null) { state.usage = chunk.usage; state.usageCount++; }
    } catch { state.invalid = true; }
  };
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      // Limit a single frame to avoid retaining arbitrary response text on a stalled stream.
      if (buffer.length > 1_000_000) { state.invalid = true; buffer = ""; }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) event();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
    },
    flush() { buffer += decoder.decode(); if (buffer.trim()) state.invalid = true; event(); },
  });
  return new Response(response.body.pipeThrough(transform), { status: response.status, headers: response.headers });
}

/** Calls the registered SDK once. Consume stream fully before reading evidence(). No key or response content enters evidence. */
export function createOpenRouterTransport(request: OpenRouterTransportRequest) {
  const { model, context, options, key, generation, route, fetch, requireReasoningUsage = false } = request;
  if (model.provider !== "openrouter" || model.api !== "openai-completions" || model.baseUrl !== "https://openrouter.ai/api/v1"
    || !identity(model.id) || !key || typeof fetch !== "function") throw new Error("Invalid OpenRouter transport configuration.");
  if (!Number.isSafeInteger(generation.maxOutputTokens) || generation.maxOutputTokens < 1 || generation.maxOutputTokens > model.maxTokens
    || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(generation.reasoning)
    || generation.reasoning !== "off" && !model.reasoning || generation.reasoning === "off" && model.reasoning && model.thinkingLevelMap?.off === null) {
    throw new Error("Unsupported OpenRouter generation settings.");
  }
  if (route.require_parameters !== true || route.allow_fallbacks !== false || route.only !== undefined && (!route.only.length || !route.only.every(identity))) {
    throw new Error("OpenRouter routing must require parameters and disable fallbacks.");
  }
  if (options?.samplingParams || options?.fetch || options?.apiKey || options?.headers || options?.onResponse || options?.env
    || options?.toolChoice === "none" || options?.transport && options.transport !== "sse") {
    throw new Error("Unsupported OpenRouter request overrides.");
  }
  const expectedReasoning = !model.reasoning ? undefined
    : generation.reasoning === "off" ? model.thinkingLevelMap?.off ?? "none" : model.thinkingLevelMap?.[generation.reasoning] ?? generation.reasoning;
  if (expectedReasoning !== undefined && (typeof expectedReasoning !== "string" || !identity(expectedReasoning))) throw new Error("Unsupported OpenRouter reasoning mapping.");
  const outputField = model.compat?.maxTokensField ?? "max_completion_tokens";
  const otherOutputField = outputField === "max_tokens" ? "max_completion_tokens" : "max_tokens";
  const evidence: OpenRouterEvidence = { status: "pending", requestedModel: model.id };
  const state: { done: boolean; usage?: unknown; usageCount: number; routedModel?: string; routedProvider?: string; responseId?: string; invalid: boolean } = { done: false, usageCount: 0, invalid: false };
  const stream = createAssistantMessageEventStream();
  // The SDK reads compat routing from the model, not stream options. Never mutate the caller's model.
  const routedModel = { ...model, compat: { ...model.compat, openRouterRouting: structuredClone(route) } };
  const upstream = streamSimple(routedModel, context, {
    ...options, apiKey: key, fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("Unexpected OpenRouter endpoint.");
      const response = await fetch(input, init);
      if (!response.ok) {
        if (response.status >= 400 && response.status <= 599) evidence.httpStatus = response.status;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([inspectErrorResponse(response, evidence, controller.signal),
            new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, 150); })]);
        } finally { if (timer) clearTimeout(timer); }
      }
      return observe(response, state);
    },
    maxRetries: 0, maxTokens: generation.maxOutputTokens, reasoning: generation.reasoning === "off" ? undefined : generation.reasoning,
    cacheRetention: "none", transport: "sse",
    onPayload: async (payload, sdkModel) => {
      if (!object(payload)) throw new Error("Invalid OpenRouter payload.");
      const before = JSON.stringify(payload);
      const extra = await options?.onPayload?.(payload, sdkModel);
      if (extra !== undefined || JSON.stringify(payload) !== before
        || Object.keys(payload).some(field => !["model", "messages", "stream", "stream_options", "store", "max_completion_tokens", "max_tokens", "reasoning", "provider", "tools", "temperature", "tool_choice", "prompt_cache_key", "prompt_cache_retention"].includes(field))
        || payload.prompt_cache_key !== undefined || payload.prompt_cache_retention !== undefined
        || payload.model !== model.id || payload[outputField] !== generation.maxOutputTokens || payload[otherOutputField] !== undefined || payload.stream !== true
        || !object(payload.stream_options) || payload.stream_options.include_usage !== true
        || (expectedReasoning === undefined ? payload.reasoning !== undefined : !object(payload.reasoning) || payload.reasoning.effort !== expectedReasoning)
        || JSON.stringify(payload.provider) !== JSON.stringify(route)
        || context.tools?.length && (!Array.isArray(payload.tools) || payload.tools.length !== context.tools.length
          || payload.tools.some((tool: unknown, index: number) => !object(tool) || tool.type !== "function"
            || !object(tool.function) || tool.function.name !== context.tools?.[index]?.name))) {
        throw new Error("OpenRouter request did not preserve model, tools, routing and generation settings.");
      }
    },
  });
  void (async () => {
    let terminal: AssistantMessage | undefined;
    try {
      for await (const event of upstream) {
        if (event.type === "error") { terminal = event.error; break; }
        if (event.type === "done") { terminal = event.message; break; }
        stream.push(event);
      }
      Object.assign(evidence, { ...(state.routedModel ? { routedModel: state.routedModel } : {}),
        ...(state.routedProvider ? { routedProvider: state.routedProvider } : {}), ...(state.responseId ? { responseId: state.responseId } : {}),
        ...(terminal && { stopReason: terminal.stopReason }) });
      const parsed = usageFrom(state.usage, generation.maxOutputTokens, requireReasoningUsage);
      if (parsed.usage) evidence.usage = parsed.usage;
      if (parsed.reportedCostUsd !== undefined) evidence.reportedCostUsd = parsed.reportedCostUsd;
      if (terminal?.stopReason === "error" || terminal?.stopReason === "aborted") evidence.reason = "provider_error";
      else if (!terminal || !state.done) evidence.reason = "stream_incomplete";
      else if (state.routedModel && state.routedModel !== model.id) evidence.reason = "model_mismatch";
      else if (state.invalid || state.usageCount > 1 || !model.reasoning && parsed.usage && parsed.usage.reasoning !== 0) evidence.reason = "usage_inconsistent";
      else if (parsed.usage && (terminal.usage.input !== parsed.usage.input || terminal.usage.output !== parsed.usage.output
        || terminal.usage.cacheRead !== parsed.usage.cacheRead || terminal.usage.cacheWrite !== parsed.usage.cacheWrite
        || terminal.usage.totalTokens !== parsed.usage.totalTokens)) evidence.reason = "usage_inconsistent";
      else evidence.reason = parsed.reason;
      if (!evidence.reason && parsed.usage && terminal && ["stop", "toolUse", "length"].includes(terminal.stopReason)) {
        evidence.status = "complete";
        evidence.usage = parsed.usage;
        stream.push({ type: "done", reason: terminal.stopReason as "stop" | "toolUse" | "length", message: terminal });
      } else {
        evidence.status = "uncertain";
        evidence.reason ??= "provider_error";
        const error: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: [], timestamp: Date.now(), stopReason: "error", errorMessage: `OpenRouter evaluation stopped: ${evidence.reason}.`,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "error", reason: "error", error });
      }
    } catch {
      evidence.status = "uncertain";
      evidence.reason = "request_invalid";
      const error: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [], timestamp: Date.now(), stopReason: "error", errorMessage: "OpenRouter evaluation request failed.",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "error", reason: "error", error });
    } finally { stream.end(); }
  })();
  return { stream, evidence: (): OpenRouterEvidence => structuredClone(evidence) };
}
