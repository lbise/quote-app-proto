import type { QuoteAssistantOutcome } from "./quote-assistant-debug";

/** One model call of an Assistant Turn, as recorded in its Turn Trace. */
export type TurnTraceModelCall = {
  /** 1 for the first call of the turn. */
  sequence: number;
  provider: string;
  model: string;
  startedAt: string;
  /** From the call until its response ended. Absent when no response arrived. */
  latencyMs?: number;
  settings: { maxTokens: number; reasoning: string; timeoutMs: number };
  /** The provider payload as the SDK built it: system prompt, tools, messages and assembled context. */
  payload?: unknown;
  /** The model context, kept only when no provider payload was built, for example when the call stopped before sending. */
  context?: unknown;
  /** The provider response: text, reasoning, tool calls, usage and stop reason. */
  response?: unknown;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number; totalTokens: number; costUsd: number };
  /** Why the call stopped before a response, when it did. */
  error?: string;
};

/** One tool call of an Assistant Turn, in execution order. */
export type TurnTraceToolCall = {
  toolCallId: string;
  name: string;
  arguments: unknown;
  outcome: "applied" | "rejected";
  /** The tool result, or the rejection returned to the model. */
  result: unknown;
  errorCode?: string;
};

/**
 * What the Quote assistant sent to and received from the model during one
 * turn. A turn that stopped before any model call has no model calls, and its
 * application context is the context that would have been sent.
 */
export type AssistantTurnRecord = {
  systemPrompt: string;
  applicationContext?: unknown;
  provider?: string;
  model?: string;
  modelCalls: TurnTraceModelCall[];
  toolCalls: TurnTraceToolCall[];
  assistantOutcome?: QuoteAssistantOutcome;
};

/** The stored content of a Turn Trace, beyond its summary columns. */
export type TurnTraceDetail = AssistantTurnRecord & {
  /** The Artisan's message. */
  text: string;
  locale: "en" | "fr";
  /** The assistant message or note the turn left in the conversation. */
  message?: { id: string; role: "assistant" | "note"; text: string };
  /** The assistant's failure diagnostic, when the turn failed in the assistant. */
  diagnostic?: { phase: string; code: string; outcome?: string; tool?: string };
};
