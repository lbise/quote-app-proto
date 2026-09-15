import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const model = { id: "gemini-2.5-flash", provider: "google", api: "google-generative-ai" };
  const streamSimple = vi.fn(() => ({ result: vi.fn() }));
  const collection = {
    setProvider: vi.fn(),
    getModel: vi.fn(() => model),
    streamSimple,
  };
  return {
    model,
    streamSimple,
    createModels: vi.fn(() => collection),
    googleProvider: vi.fn(() => ({ id: "google" })),
  };
});

vi.mock("@earendil-works/pi-ai", () => ({ createModels: mocked.createModels }));
vi.mock("@earendil-works/pi-ai/providers/google", () => ({ googleProvider: mocked.googleProvider }));

import { configuredQuoteAI } from "./quote-ai-config.server";

const fictionalGoogle = {
  QUOTE_AI_ENABLED: "true",
  QUOTE_AI_PROVIDER: "google",
  QUOTE_AI_MODEL: "gemini-2.5-flash",
  GEMINI_API_KEY: "selected-key",
  QUOTE_AI_FICTIONAL_TEST_MODE: "true",
  QUOTE_AI_NO_TRAINING_CONFIRMED: "false",
  DATABASE_URL: "postgresql://easy_quote@127.0.0.1:55433/easy_quote_fictional",
  BETTER_AUTH_URL: "http://127.0.0.1:5175",
  AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:5175",
  AUTH_ALLOWED_EMAILS: "fictional-artisan@example.test",
  QUOTE_AI_FICTIONAL_TEST_IDENTITIES: "fictional-artisan@example.test",
  QUOTE_AI_FICTIONAL_TERMS_REVIEW_REFERENCE: "LEGAL-TEST-001",
};

describe("configured Quote AI stream", () => {
  it("pins the selected credential and provider environment on models.streamSimple", () => {
    const configured = configuredQuoteAI(fictionalGoogle);
    const context = { messages: [] };
    const options = { apiKey: "ambient-key", env: { GEMINI_API_KEY: "ambient-key" }, maxTokens: 100 };

    configured.streamFn(mocked.model as never, context, options);

    expect(mocked.streamSimple).toHaveBeenCalledWith(
      mocked.model,
      context,
      expect.objectContaining({
        apiKey: "selected-key",
        env: { GEMINI_API_KEY: "selected-key" },
        maxTokens: 100,
      }),
    );
  });
});
