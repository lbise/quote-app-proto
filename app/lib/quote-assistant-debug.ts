export type QuoteAssistantDiagnosticPhase = "model" | "tool" | "validation" | "persistence";

export type QuoteAssistantLlmRequest = {
  model: { provider: string; id: string };
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
  options: Record<string, unknown>;
};

/** Diagnostic metadata returned only when explicitly enabled for debugging. */
export type QuoteAssistantToolCall = { name: string; arguments: unknown };

export type QuoteAssistantSuccessDebug = {
  toolCalls: QuoteAssistantToolCall[];
  requestId?: string;
};

export type QuoteAssistantDiagnostic = {
  phase: QuoteAssistantDiagnosticPhase;
  code: string;
  tool?: string;
  toolCall?: QuoteAssistantToolCall;
  llmRequest?: QuoteAssistantLlmRequest;
  requestId?: string;
};
