export type QuoteAssistantDiagnosticPhase = "model" | "tool" | "validation" | "persistence";

/** Safe diagnostic metadata. Never add prompt text, tool arguments or provider payloads here. */
export type QuoteAssistantDiagnostic = {
  phase: QuoteAssistantDiagnosticPhase;
  code: string;
  tool?: string;
  requestId?: string;
};
