import { describe, expect, it } from "vitest";

import {
  assertQuoteAIConfiguration,
  configuredQuoteAI,
  quoteAIDisclosure,
} from "./quote-ai-config.server";

const google = {
  QUOTE_AI_PROVIDER: "google",
  QUOTE_AI_MODEL: "gemini-2.5-flash",
  GEMINI_API_KEY: "test-key",
};

const openrouter = {
  QUOTE_AI_PROVIDER: "openrouter",
  QUOTE_AI_MODEL: "example/tool-model",
  OPENROUTER_API_KEY: "openrouter-test-key",
  QUOTE_AI_SPEND_LIMIT_USD: "5",
};

describe("Quote AI configuration", () => {
  it("requires provider, model, and credential configuration", async () => {
    expect(() => assertQuoteAIConfiguration({})).toThrow("QUOTE_AI_PROVIDER is required");
    await expect(configuredQuoteAI({ ...google, GEMINI_API_KEY: "" })).rejects.toThrow("GEMINI_API_KEY is required");
    await expect(configuredQuoteAI({ ...google, QUOTE_AI_MODEL: "" })).rejects.toThrow("QUOTE_AI_MODEL is required");
  });

  it("uses only the selected registered Google model", async () => {
    const configured = await configuredQuoteAI(google);

    expect(configured.model).toMatchObject({ provider: "google", id: "gemini-2.5-flash" });
    expect(configured.streamFn).toBeTypeOf("function");
    expect(configured.timeoutMs).toBe(20_000);
    expect(configured.generation).toBeUndefined();
  });

  it("fails closed for an unregistered provider or model", async () => {
    await expect(configuredQuoteAI({ ...google, QUOTE_AI_PROVIDER: "untrusted-proxy" }))
      .rejects.toThrow("QUOTE_AI_PROVIDER must name a registered provider");
    await expect(configuredQuoteAI({ ...google, QUOTE_AI_PROVIDER: "__proto__" }))
      .rejects.toThrow("QUOTE_AI_PROVIDER must name a registered provider");
    await expect(configuredQuoteAI({ ...google, QUOTE_AI_MODEL: "anything-goes" }))
      .rejects.toThrow("QUOTE_AI_MODEL is not registered for provider google");
  });

  it("selects another supported model and validates the execution deadline", async () => {
    expect((await configuredQuoteAI({ ...google, QUOTE_AI_MODEL: "gemini-2.5-pro", QUOTE_AI_TIMEOUT_MS: "45000" })).model.id)
      .toBe("gemini-2.5-pro");
    for (const deadline of ["0", "999", "45001", "1000.1", "infinity"]) {
      await expect(configuredQuoteAI({ ...google, QUOTE_AI_TIMEOUT_MS: deadline })).rejects.toThrow("QUOTE_AI_TIMEOUT_MS");
    }
  });

  it("validates deployment generation settings against the Google model at startup", async () => {
    expect(() => assertQuoteAIConfiguration(google)).not.toThrow();
    // Gemini 3.5 Flash-Lite cannot turn reasoning off; the SDK would substitute MINIMAL.
    const flashLite = { ...google, QUOTE_AI_MODEL: "gemini-3.5-flash-lite" };
    expect(() => assertQuoteAIConfiguration(flashLite)).toThrow("requires an explicit reasoning setting");
    expect(() => assertQuoteAIConfiguration({ ...flashLite, QUOTE_AI_REASONING: "off" })).toThrow("off is not supported");
    expect(() => assertQuoteAIConfiguration({ ...flashLite, QUOTE_AI_REASONING: "minimal" })).not.toThrow();
    expect(() => assertQuoteAIConfiguration({ ...flashLite, QUOTE_AI_REASONING: "minimal", QUOTE_AI_MAX_OUTPUT_TOKENS: "65537" })).toThrow("1 through 65536");
    expect(() => assertQuoteAIConfiguration({ ...google, QUOTE_AI_REASONING: "extreme" })).toThrow("QUOTE_AI_REASONING must be one of");
    for (const limit of ["0", "-1", "1.5", "lots"]) {
      expect(() => assertQuoteAIConfiguration({ ...google, QUOTE_AI_MAX_OUTPUT_TOKENS: limit })).toThrow("QUOTE_AI_MAX_OUTPUT_TOKENS");
    }
    expect((await configuredQuoteAI({ ...flashLite, QUOTE_AI_REASONING: "low", QUOTE_AI_MAX_OUTPUT_TOKENS: "2048" })).generation)
      .toEqual({ reasoning: "low", maxOutputTokens: 2048 });
  });

  it("validates OpenRouter credentials, exact model ID and spend ceiling without a network call", () => {
    expect(() => assertQuoteAIConfiguration(openrouter)).not.toThrow();
    expect(() => assertQuoteAIConfiguration({ ...openrouter, OPENROUTER_API_KEY: "" })).toThrow("OPENROUTER_API_KEY is required");
    expect(() => assertQuoteAIConfiguration({ ...openrouter, GEMINI_API_KEY: "wrong-provider-key", OPENROUTER_API_KEY: "" })).toThrow("OPENROUTER_API_KEY is required");
    expect(() => assertQuoteAIConfiguration({ ...openrouter, QUOTE_AI_MODEL: "tool-model" })).toThrow("exact OpenRouter model ID");
    expect(() => assertQuoteAIConfiguration({ ...openrouter, QUOTE_AI_MODEL: "https://proxy.example/v1" })).toThrow("exact OpenRouter model ID");
    expect(() => assertQuoteAIConfiguration({ ...openrouter, QUOTE_AI_SPEND_LIMIT_USD: "" })).toThrow("QUOTE_AI_SPEND_LIMIT_USD is required");
    for (const limit of ["0", "-1", "1.0000000001", "unlimited", "1000001"]) {
      expect(() => assertQuoteAIConfiguration({ ...openrouter, QUOTE_AI_SPEND_LIMIT_USD: limit })).toThrow("QUOTE_AI_SPEND_LIMIT_USD must be");
    }
    expect(() => assertQuoteAIConfiguration({ ...openrouter, QUOTE_AI_REASONING: "extreme" })).toThrow("QUOTE_AI_REASONING must be one of");
  });

  it("always discloses the configured provider without exposing credentials", () => {
    expect(quoteAIDisclosure(google)).toEqual({ providerName: "Google Gemini Developer API" });
    expect(quoteAIDisclosure(openrouter)).toEqual({ providerName: "OpenRouter" });
    expect(JSON.stringify(quoteAIDisclosure(openrouter))).not.toContain("openrouter-test-key");
  });
});
