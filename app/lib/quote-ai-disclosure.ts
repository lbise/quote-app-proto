/** Browser-safe provider identity; the UI uses it in the complete-draft disclosure. */
export type QuoteAIDisclosure = {
  providerName: string;
  /** Receives dictated audio. Absent when dictation is unavailable. */
  transcriptionProviderName?: string;
};
