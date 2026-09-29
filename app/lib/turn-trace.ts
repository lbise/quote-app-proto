import type { QuoteAssistantOutcome } from "./quote-assistant-debug";

/**
 * The outcome Administrators filter Assistant Turns by. It refines the turn's
 * outcome: a committed turn may have had failed tool calls, and a discarded
 * turn may have failed at the provider or before any model call was sent.
 */
export const turnOutcomeKinds = ["committed", "committed_with_failed_calls", "unchanged", "discarded", "provider_error", "failed_before_model_call"] as const;
export type TurnOutcomeKind = typeof turnOutcomeKinds[number];

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

/** One step of an Assistant Turn, for reading a Turn Trace in order. */
export type TurnTraceStep = { kind: "model"; call: TurnTraceModelCall } | { kind: "tool"; call: TurnTraceToolCall };

function requestedToolCallIds(call: TurnTraceModelCall): string[] {
  const content = (call.response as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "toolCall" && typeof (part as { id?: unknown }).id === "string"
    ? [(part as { id: string }).id] : []);
}

/**
 * Model calls and tool calls in the order they happened: each model call is
 * followed by the tool calls its response asked for. Tool calls that match no
 * response come last.
 */
export function turnTraceSteps(trace: Pick<AssistantTurnRecord, "modelCalls" | "toolCalls">): TurnTraceStep[] {
  const remaining = [...trace.toolCalls];
  const steps: TurnTraceStep[] = [];
  for (const call of trace.modelCalls) {
    steps.push({ kind: "model", call });
    for (const id of requestedToolCallIds(call)) {
      const index = remaining.findIndex((tool) => tool.toolCallId === id);
      if (index >= 0) steps.push({ kind: "tool", call: remaining.splice(index, 1)[0] });
    }
  }
  return [...steps, ...remaining.map((call) => ({ kind: "tool" as const, call }))];
}
