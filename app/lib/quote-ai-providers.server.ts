// Adding a provider requires an intentional registration here. Environment
// variables may select a registered provider, never a custom endpoint.
export const registeredProviders = {
  google: { credential: "GEMINI_API_KEY", publicName: "Google Gemini Developer API" },
  openrouter: { credential: "OPENROUTER_API_KEY", publicName: "OpenRouter" },
} as const;

export type ProviderId = keyof typeof registeredProviders;
