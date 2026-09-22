export type QuoteAssistantDiagnosticPhase = "model" | "tool" | "validation" | "persistence";

export type QuoteAssistantLlmRequest = {
  model: { provider: string; id: string };
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
  options: Record<string, unknown>;
};

export type QuoteAssistantToolCall = { name: string; arguments: unknown };
export type QuoteAssistantAttemptOutcome = "applied" | "failed";
export type QuoteAssistantToolAttempt = QuoteAssistantToolCall & {
  /** Transient tool return value for explicit local diagnostics and evaluation. */
  result?: unknown;
  outcome: QuoteAssistantAttemptOutcome;
  validation: { outcome: "accepted" | "rejected"; code?: string };
  stateSequence: number;
  failedCalls: number;
  failureLimit: number;
  errorCode?: string;
};
export type QuoteAssistantOutcome = "committed" | "committed_with_failed_calls" | "unchanged" | "unchanged_with_failed_calls" | "discarded" | "failed_call_limit_reached" | "later_budget_exhausted" | "draft_context_too_large" | "stale";

/** Diagnostic metadata returned only when explicitly enabled for debugging. */
export type QuoteAssistantSuccessDebug = {
  toolCalls: QuoteAssistantToolCall[];
  llmRequest?: QuoteAssistantLlmRequest;
  llmRequests?: QuoteAssistantLlmRequest[];
  attempts?: QuoteAssistantToolAttempt[];
  failedCalls?: number;
  failureLimit?: number;
  outcome?: QuoteAssistantOutcome;
  requestId?: string;
  finalValidation?: { outcome: "accepted" | "rejected"; code?: string };
};

export type QuoteAssistantDiagnostic = {
  phase: QuoteAssistantDiagnosticPhase;
  code: string;
  tool?: string;
  toolCall?: QuoteAssistantToolCall;
  attempts?: QuoteAssistantToolAttempt[];
  failedCalls?: number;
  failureLimit?: number;
  outcome?: QuoteAssistantOutcome;
  validation?: { outcome: "accepted" | "rejected"; code?: string };
  stateSequence?: number;
  notSent?: boolean;
  applicationContext?: unknown;
  llmRequest?: QuoteAssistantLlmRequest;
  llmRequests?: QuoteAssistantLlmRequest[];
  requestId?: string;
};
