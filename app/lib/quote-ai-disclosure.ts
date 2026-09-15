export type QuoteAIDisclosure = {
  enabled: boolean;
  providerName: string | null;
  mode: "disabled" | "fictional-test" | "production-gated";
};
