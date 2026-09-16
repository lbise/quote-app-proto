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

describe("Quote AI configuration", () => {
  it("requires provider, model, and credential configuration", () => {
    expect(() => assertQuoteAIConfiguration({})).toThrow("QUOTE_AI_PROVIDER is required");
    expect(() => configuredQuoteAI({ ...google, GEMINI_API_KEY: "" })).toThrow("GEMINI_API_KEY is required");
    expect(() => configuredQuoteAI({ ...google, QUOTE_AI_MODEL: "" })).toThrow("QUOTE_AI_MODEL is required");
  });

  it("uses only the selected registered Google model", () => {
    const configured = configuredQuoteAI(google);

    expect(configured.model).toMatchObject({ provider: "google", id: "gemini-2.5-flash" });
    expect(configured.streamFn).toBeTypeOf("function");
    expect(configured.timeoutMs).toBe(20_000);
  });

  it("fails closed for an unregistered provider or model", () => {
    expect(() => configuredQuoteAI({ ...google, QUOTE_AI_PROVIDER: "untrusted-proxy" }))
      .toThrow("QUOTE_AI_PROVIDER must name a registered provider");
    expect(() => configuredQuoteAI({ ...google, QUOTE_AI_PROVIDER: "__proto__" }))
      .toThrow("QUOTE_AI_PROVIDER must name a registered provider");
    expect(() => configuredQuoteAI({ ...google, QUOTE_AI_MODEL: "anything-goes" }))
      .toThrow("QUOTE_AI_MODEL is not registered for provider google");
  });

  it("selects another supported model and validates the execution deadline", () => {
    expect(configuredQuoteAI({ ...google, QUOTE_AI_MODEL: "gemini-2.5-pro", QUOTE_AI_TIMEOUT_MS: "45000" }).model.id)
      .toBe("gemini-2.5-pro");
    for (const deadline of ["0", "999", "45001", "1000.1", "infinity"]) {
      expect(() => configuredQuoteAI({ ...google, QUOTE_AI_TIMEOUT_MS: deadline })).toThrow("QUOTE_AI_TIMEOUT_MS");
    }
  });

  it("always discloses the configured provider without exposing credentials", () => {
    expect(quoteAIDisclosure(google)).toEqual({
      providerName: "Google Gemini Developer API",
    });
  });
});
