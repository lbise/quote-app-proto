export type QuoteAssistantDiagnosticPhase = "model" | "tool" | "validation" | "persistence";

export type QuoteAssistantLlmRequest = {
  model: { provider: string; id: string };
  systemPrompt: string;
  messages: unknown[];
  tools: unknown[];
  options: Record<string, unknown>;
};

/** Diagnostic metadata returned only when explicitly enabled for debugging. */
export type QuoteAssistantDiagnostic = {
  phase: QuoteAssistantDiagnosticPhase;
  code: string;
  tool?: string;
  toolCall?: { name: string; arguments: unknown };
  llmRequest?: QuoteAssistantLlmRequest;
  requestId?: string;
};
