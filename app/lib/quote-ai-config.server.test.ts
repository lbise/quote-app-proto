import { describe, expect, it } from "vitest";

import {
  assertQuoteAIConfiguration,
  configuredQuoteAI,
  isFictionalQuoteAITest,
  isFictionalTestIdentity,
  quoteAIDisclosure,
} from "./quote-ai-config.server";

const enabledGoogle = {
  QUOTE_AI_ENABLED: "true",
  QUOTE_AI_PROVIDER: "google",
  QUOTE_AI_MODEL: "gemini-2.5-flash",
  GEMINI_API_KEY: "test-key",
};

const fictionalGoogle = {
  ...enabledGoogle,
  QUOTE_AI_FICTIONAL_TEST_MODE: "true",
  QUOTE_AI_NO_TRAINING_CONFIRMED: "false",
  DATABASE_URL: "postgresql://easy_quote@127.0.0.1:55433/easy_quote_fictional",
  BETTER_AUTH_URL: "http://127.0.0.1:5175",
  AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:5175",
  AUTH_ALLOWED_EMAILS: "fictional-artisan@example.test",
  QUOTE_AI_FICTIONAL_TEST_IDENTITIES: "fictional-artisan@example.test",
  QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE: "LEGAL-TEST-001",
};

describe("Quote AI configuration", () => {
  it("uses only the selected registered Google model", () => {
    const configured = configuredQuoteAI(fictionalGoogle);

    expect(configured.model).toMatchObject({ provider: "google", id: "gemini-2.5-flash" });
    expect(configured.streamFn).toBeTypeOf("function");
    expect(configured.timeoutMs).toBe(20_000);
  });

  it("fails closed for an unregistered provider, model, or credential", () => {
    expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_PROVIDER: "untrusted-proxy" }))
      .toThrow("QUOTE_AI_PROVIDER must name a registered provider");
    expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_PROVIDER: "__proto__" }))
      .toThrow("QUOTE_AI_PROVIDER must name a registered provider");
    expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_MODEL: "anything-goes" }))
      .toThrow("QUOTE_AI_MODEL is not registered for provider google");
    expect(() => configuredQuoteAI({ ...fictionalGoogle, GEMINI_API_KEY: "" }))
      .toThrow("GEMINI_API_KEY is required");
  });

  it("requires a recorded review as well as the production no-training gate", () => {
    const production = { ...enabledGoogle, NODE_ENV: "production" };

    expect(() => assertQuoteAIConfiguration(production))
      .toThrow("QUOTE_AI_NO_TRAINING_CONFIRMED=true is required");
    expect(() => assertQuoteAIConfiguration({ ...production, QUOTE_AI_NO_TRAINING_CONFIRMED: "true" }))
      .toThrow("QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE is required");
    expect(() => assertQuoteAIConfiguration({
      ...production,
      QUOTE_AI_NO_TRAINING_CONFIRMED: "true",
      QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE: "SEC-123",
    })).not.toThrow();
  });

  it("permits unpaid Google testing only in the isolated fictional configuration", () => {
    const fictional = fictionalGoogle;

    expect(() => assertQuoteAIConfiguration(fictional)).not.toThrow();
    expect(isFictionalQuoteAITest(fictional)).toBe(true);
    expect(isFictionalTestIdentity("fictional-artisan@example.test", fictional)).toBe(true);
    expect(isFictionalTestIdentity("real-artisan@example.com", fictional)).toBe(false);
    expect(() => assertQuoteAIConfiguration({ ...fictional, QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE: "" }))
      .toThrow("QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE is required");
    expect(() => assertQuoteAIConfiguration({ ...fictional, NODE_ENV: "production" }))
      .toThrow("cannot run in production");
    expect(() => assertQuoteAIConfiguration({ ...fictional, AUTH_ALLOWED_EMAILS: "*" }))
      .toThrow("explicit fictional test identities");
    expect(() => assertQuoteAIConfiguration({ ...fictional, DATABASE_URL: "postgresql://easy_quote@db/easy_quote_fictional" }))
      .toThrow("loopback PostgreSQL");
    expect(() => assertQuoteAIConfiguration({ ...fictional, AUTH_TRUSTED_ORIGINS: "http://192.168.1.20:5175" }))
      .toThrow("loopback HTTP origin");
  });

  it("cannot relabel unpaid testing as production approval or use the normal application database", () => {
    expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_NO_TRAINING_CONFIRMED: "true" })).toThrow("must not assert");
    expect(() => configuredQuoteAI({ ...fictionalGoogle, DATABASE_URL: "postgresql://easy_quote@127.0.0.1:55432/easy_quote_local" })).toThrow("fictional database");
    expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_FICTIONAL_TEST_MODE: "false" })).toThrow("requires QUOTE_AI_FICTIONAL_TEST_MODE=true");
    expect(() => configuredQuoteAI({ ...fictionalGoogle, NODE_ENV: "production", QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE: "SEC-123" })).toThrow("cannot run in production");
  });

  it("selects another supported model by configuration and validates the execution deadline", () => {
    expect(configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_MODEL: "gemini-2.5-pro", QUOTE_AI_TIMEOUT_MS: "45000" }).model.id).toBe("gemini-2.5-pro");
    for (const deadline of ["0", "999", "45001", "1000.1", "infinity"]) {
      expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_TIMEOUT_MS: deadline })).toThrow("QUOTE_AI_TIMEOUT_MS");
    }
    expect(() => configuredQuoteAI({ ...fictionalGoogle, QUOTE_AI_ENABLED: "false" })).toThrow("Quote AI is disabled");
  });

  it("returns only safe provider and processing-mode disclosure data", () => {
    expect(quoteAIDisclosure({ QUOTE_AI_ENABLED: "false" })).toEqual({
      enabled: false,
      providerName: null,
      mode: "disabled",
    });
    expect(quoteAIDisclosure(fictionalGoogle)).toEqual({
      enabled: true,
      providerName: "Google Gemini Developer API",
      mode: "fictional-test",
    });
    expect(quoteAIDisclosure({
      ...enabledGoogle,
      NODE_ENV: "production",
      QUOTE_AI_NO_TRAINING_CONFIRMED: "true",
      QUOTE_AI_DATA_PROCESSING_REVIEW_REFERENCE: "SEC-123",
    })).toEqual({
      enabled: true,
      providerName: "Google Gemini Developer API",
      mode: "production-gated",
    });
  });
});
