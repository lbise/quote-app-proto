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

const google = {
  QUOTE_AI_PROVIDER: "google",
  QUOTE_AI_MODEL: "gemini-2.5-flash",
  GEMINI_API_KEY: "selected-key",
};

describe("configured Quote AI stream", () => {
  it("pins the selected credential and provider environment on models.streamSimple", () => {
    const configured = configuredQuoteAI(google);
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
