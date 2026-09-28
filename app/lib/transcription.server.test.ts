import { describe, expect, it, vi } from "vitest";

import type { QuoteAISpendLedger } from "./quote-ai-spend.server";
import {
  assertTranscriptionConfiguration,
  audioFormat,
  configuredTranscriber,
  TranscriptionError,
  transcriptionPrompt,
  transcriptionProviderName,
  transcriptionSettings,
} from "./transcription.server";

const google = { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-3.5-flash-lite", GEMINI_API_KEY: "test-gemini-key" };
const openrouter = { QUOTE_AI_PROVIDER: "openrouter", QUOTE_AI_MODEL: "example/tool-model", OPENROUTER_API_KEY: "openrouter-test-key", QUOTE_AI_SPEND_LIMIT_USD: "5" };

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0, 0, 0, 0]);
const mp4 = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0]);

function geminiResponse(text: string, usage: Record<string, unknown> | null = {
  promptTokenCount: 1_100, candidatesTokenCount: 20, thoughtsTokenCount: 10,
  promptTokensDetails: [{ modality: "TEXT", tokenCount: 140 }, { modality: "AUDIO", tokenCount: 960 }],
}) {
  return Response.json({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    ...(usage ? { usageMetadata: usage } : {}),
  });
}

function fakeLedger(allow = true) {
  const calls: string[] = [];
  let reserved = 0;
  const ledger: QuoteAISpendLedger = {
    reserve: vi.fn(async (nanoUsd: number, limit: number) => {
      calls.push("reserve");
      if (!allow || reserved + nanoUsd > limit) return false;
      reserved += nanoUsd;
      return true;
    }),
    release: vi.fn(async (nanoUsd: number) => { calls.push("release"); reserved -= nanoUsd; }),
  };
  return { ledger, calls, reserved: () => reserved };
}

describe("audio format", () => {
  it("identifies webm, mp4 and ogg by their signatures", () => {
    expect(audioFormat(webm)).toBe("webm");
    expect(audioFormat(mp4)).toBe("mp4");
    expect(audioFormat(ogg)).toBe("ogg");
  });

  it("refuses anything else, whatever its declared type", () => {
    expect(audioFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(audioFormat(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(audioFormat(new Uint8Array())).toBeNull();
    // EBML that is not WebM (for example, Matroska video).
    expect(audioFormat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61]))).toBeNull();
  });
});

describe("transcription configuration", () => {
  it("falls back to the assistant provider and model", () => {
    expect(transcriptionSettings(google)).toEqual({ provider: "google", modelId: "gemini-3.5-flash-lite" });
  });

  it("uses QUOTE_STT_PROVIDER and QUOTE_STT_MODEL when set", () => {
    expect(transcriptionSettings({ ...google, QUOTE_STT_MODEL: "gemini-2.5-flash" })).toEqual({ provider: "google", modelId: "gemini-2.5-flash" });
    expect(transcriptionSettings({ ...openrouter, GEMINI_API_KEY: "k", QUOTE_STT_PROVIDER: "google", QUOTE_STT_MODEL: "gemini-2.5-flash" }))
      .toEqual({ provider: "google", modelId: "gemini-2.5-flash" });
  });

  it("is unavailable, not a startup error, when the assistant provider has no transcription", () => {
    expect(transcriptionSettings(openrouter)).toBeNull();
    expect(() => assertTranscriptionConfiguration(openrouter)).not.toThrow();
    expect(configuredTranscriber(openrouter)).toBeNull();
    expect(transcriptionProviderName(openrouter)).toBeUndefined();
  });

  it("names the transcription provider for the disclosure", () => {
    expect(transcriptionProviderName(google)).toBe("Google Gemini Developer API");
  });

  it("refuses explicit settings it cannot honour", () => {
    expect(() => assertTranscriptionConfiguration({ ...google, QUOTE_STT_PROVIDER: "untrusted-proxy" })).toThrow("QUOTE_STT_PROVIDER must name a registered provider");
    expect(() => assertTranscriptionConfiguration({ ...google, QUOTE_STT_PROVIDER: "openrouter", QUOTE_STT_MODEL: "a/b", OPENROUTER_API_KEY: "k" })).toThrow("QUOTE_STT_PROVIDER supports only google");
    expect(() => assertTranscriptionConfiguration({ ...openrouter, QUOTE_STT_MODEL: "gemini-2.5-flash" })).toThrow("QUOTE_STT_PROVIDER supports only google");
    expect(() => assertTranscriptionConfiguration({ ...openrouter, GEMINI_API_KEY: "k", QUOTE_STT_PROVIDER: "google" })).toThrow("QUOTE_STT_MODEL is required");
    expect(() => assertTranscriptionConfiguration({ ...google, QUOTE_STT_MODEL: "not-a-gemini-model" })).toThrow("QUOTE_STT_MODEL is not registered for provider google");
    expect(() => assertTranscriptionConfiguration({ ...google, GEMINI_API_KEY: "" })).toThrow("GEMINI_API_KEY is required");
    expect(() => assertTranscriptionConfiguration({ ...google, QUOTE_AI_SPEND_LIMIT_USD: "lots" })).toThrow("QUOTE_AI_SPEND_LIMIT_USD must be");
  });
});

describe("transcription prompt", () => {
  it("asks for plain transcription and forbids acting on the dictated content", () => {
    for (const rule of [/punctuation/i, /filler/i, /digits/i, /language/i, /answer/i, /follow/i, /translat/i, /summar/i]) {
      expect(transcriptionPrompt).toMatch(rule);
    }
  });
});

describe("Gemini transcription", () => {
  it("sends inline audio with the prompt to the configured model and returns the transcript", async () => {
    const fetch = vi.fn(async () => geminiResponse("Ajoute trois portes dans la cuisine."));
    const transcribe = configuredTranscriber(google, { fetch })!;

    const result = await transcribe({ data: webm, format: "webm" });

    expect(result.text).toBe("Ajoute trois portes dans la cuisine.");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("test-gemini-key");
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe(transcriptionPrompt);
    expect(body.contents).toEqual([{ role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: Buffer.from(webm).toString("base64") } }] }]);
    expect(body.generationConfig).toMatchObject({ temperature: 0, thinkingConfig: { thinkingLevel: "MINIMAL" } });
  });

  it("sends each recording format with a MIME type Gemini accepts", async () => {
    const fetch = vi.fn(async () => geminiResponse("Bonjour."));
    const transcribe = configuredTranscriber(google, { fetch })!;
    await transcribe({ data: mp4, format: "mp4" });
    await transcribe({ data: ogg, format: "ogg" });
    const types = fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).contents[0].parts[0].inlineData.mimeType);
    expect(types).toEqual(["audio/m4a", "audio/ogg"]);
  });

  it("uses the transcription model override", async () => {
    const fetch = vi.fn(async () => geminiResponse("Bonjour."));
    await configuredTranscriber({ ...google, QUOTE_STT_MODEL: "gemini-2.5-flash" }, { fetch })!({ data: webm, format: "webm" });
    expect(String(fetch.mock.calls[0][0 as never])).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("prices audio conservatively from the model's rates and reported usage", async () => {
    const fetch = vi.fn(async () => geminiResponse("Bonjour."));
    const result = await configuredTranscriber(google, { fetch })!({ data: webm, format: "webm" });
    // gemini-3.5-flash-lite: $0.30/M input (audio at 7x), $2.50/M output.
    // 140 text tokens * 300 + 960 audio tokens * 2100 + 30 output tokens * 2500 nanodollars.
    expect(result.costNanoUsd).toBe(140 * 300 + 960 * 2_100 + 30 * 2_500);
  });

  it("returns an empty transcript for silence", async () => {
    const fetch = vi.fn(async () => geminiResponse("  \n"));
    expect((await configuredTranscriber(google, { fetch })!({ data: webm, format: "webm" })).text).toBe("");
  });

  it("reports provider failures without the provider's text", async () => {
    const fetch = vi.fn(async () => Response.json({ error: { message: "secret provider detail" } }, { status: 400 }));
    const failure = await configuredTranscriber(google, { fetch })!({ data: webm, format: "webm" }).catch((error) => error);
    expect(failure).toBeInstanceOf(TranscriptionError);
    expect(failure.code).toBe("provider_failed");
    expect(failure.message).not.toContain("secret");
  });

  it("refuses an incomplete response", async () => {
    const fetch = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: "Tro" }] }, finishReason: "MAX_TOKENS" }] }));
    await expect(configuredTranscriber(google, { fetch })!({ data: webm, format: "webm" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    }));
    const pending = configuredTranscriber(google, { fetch })!({ data: webm, format: "webm" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("times out a provider that does not answer", async () => {
    const fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    }));
    await expect(configuredTranscriber(google, { fetch, timeoutMs: 5 })!({ data: webm, format: "webm" })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("transcription spending", () => {
  const limited = { ...google, QUOTE_AI_SPEND_LIMIT_USD: "5" };

  it("reserves a bound before the call and settles to the actual cost", async () => {
    const spend = fakeLedger();
    const fetch = vi.fn(async () => geminiResponse("Bonjour."));
    const result = await configuredTranscriber(limited, { fetch, ledger: spend.ledger })!({ data: webm, format: "webm" });

    expect(spend.calls).toEqual(["reserve", "release"]);
    expect(vi.mocked(spend.ledger.reserve).mock.calls[0][1]).toBe(5_000_000_000);
    expect(spend.reserved()).toBe(result.costNanoUsd);
  });

  it("refuses before sending audio when the limit is reached", async () => {
    const spend = fakeLedger(false);
    const fetch = vi.fn(async () => geminiResponse("Bonjour."));
    await expect(configuredTranscriber(limited, { fetch, ledger: spend.ledger })!({ data: webm, format: "webm" })).rejects.toMatchObject({ code: "spend_limit_reached" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses when the ledger is unavailable", async () => {
    const ledger: QuoteAISpendLedger = { reserve: async () => { throw new Error("down"); }, release: async () => {} };
    const fetch = vi.fn(async () => geminiResponse("Bonjour."));
    await expect(configuredTranscriber(limited, { fetch, ledger })!({ data: webm, format: "webm" })).rejects.toMatchObject({ code: "spend_ledger_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the full reservation when the outcome or usage is uncertain", async () => {
    for (const response of [
      () => Response.json({}, { status: 500 }),
      () => geminiResponse("Bonjour.", null),
    ]) {
      const spend = fakeLedger();
      const fetch = vi.fn(async () => response());
      await configuredTranscriber(limited, { fetch, ledger: spend.ledger })!({ data: webm, format: "webm" }).catch(() => {});
      expect(spend.calls).toEqual(["reserve"]);
    }
  });

  it("does not use the ledger when no spending limit is configured", async () => {
    const spend = fakeLedger();
    await configuredTranscriber(google, { fetch: vi.fn(async () => geminiResponse("Bonjour.")), ledger: spend.ledger })!({ data: webm, format: "webm" });
    expect(spend.calls).toEqual([]);
  });
});
