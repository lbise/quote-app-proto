import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createAuthForDatabase } from "./auth.server";
import { connectDatabase } from "./db.server";
import { user } from "./db/schema";
import { MAX_AUDIO_BYTES } from "./dictation";
import { databaseSpendLedger, reservedSpendNanoUsd } from "./quote-ai-spend.server";
import { createTranscriptionHandler } from "./transcription-http.server";
import { configuredTranscriber, TranscriptionError, type Transcriber } from "./transcription.server";

const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 1, 2, 3, 4]);
const mp4 = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** Nanodollars as the decimal USD string QUOTE_AI_SPEND_LIMIT_USD expects. */
const usd = (nanoUsd: number) => `${BigInt(nanoUsd) / 1_000_000_000n}.${String(BigInt(nanoUsd) % 1_000_000_000n).padStart(9, "0")}`;

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))("transcription upload", () => {
  const connection = connectDatabase(process.env.TEST_DATABASE_URL!);
  const auth = createAuthForDatabase(connection.db);
  const origin = "http://localhost:5173";
  const originalRegistration = process.env.REGISTRATION_MODE;
  const originalDelivery = process.env.EMAIL_DELIVERY;
  let cookie = "";

  beforeAll(async () => {
    process.env.REGISTRATION_MODE = "open";
    process.env.EMAIL_DELIVERY = "fake";
    const email = `transcription-${crypto.randomUUID()}@example.com`;
    const signedUp = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dictating Artisan", email, password: "password123" }),
    }));
    const account = await signedUp.json();
    await connection.db.update(user).set({ emailVerified: true }).where(eq(user.id, account.user.id));
    const signedIn = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    }));
    cookie = signedIn.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  });

  afterAll(async () => {
    if (originalRegistration === undefined) delete process.env.REGISTRATION_MODE;
    else process.env.REGISTRATION_MODE = originalRegistration;
    if (originalDelivery === undefined) delete process.env.EMAIL_DELIVERY;
    else process.env.EMAIL_DELIVERY = originalDelivery;
    await connection.pool.end();
  });

  function scripted(result: Awaited<ReturnType<Transcriber>> | TranscriptionError = { text: "Ajoute trois portes.", costNanoUsd: 1 }) {
    return vi.fn<Transcriber>(async () => { if (result instanceof TranscriptionError) throw result; return result; });
  }

  function upload(transcriber: Transcriber | null, body: BodyInit | null, headers: Record<string, string> = {}) {
    const handler = createTranscriptionHandler({ database: connection.db, auth, transcriber });
    return handler(new Request(`${origin}/api/transcriptions`, { method: "POST", headers: { cookie, origin, "content-type": "audio/webm", ...headers }, body, duplex: "half" } as RequestInit));
  }

  it("transcribes raw audio for a signed-in Artisan without storing it", async () => {
    const transcriber = scripted();
    const response = await upload(transcriber, webm as Uint8Array<ArrayBuffer>);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: "Ajoute trois portes." });
    const [audio] = transcriber.mock.calls[0];
    expect(audio).toEqual({ data: webm, format: "webm" });
  });

  it("identifies the format from the bytes, not the declared type", async () => {
    const transcriber = scripted();
    expect((await upload(transcriber, mp4 as Uint8Array<ArrayBuffer>, { "content-type": "audio/webm" })).status).toBe(200);
    expect(transcriber.mock.calls[0][0].format).toBe("mp4");
  });

  it("requires a signed-in Artisan and a trusted origin", async () => {
    const transcriber = scripted();
    const handler = createTranscriptionHandler({ database: connection.db, auth, transcriber });
    const anonymous = await handler(new Request(`${origin}/api/transcriptions`, { method: "POST", headers: { origin }, body: webm as Uint8Array<ArrayBuffer> }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "authentication_required" });
    const crossSite = await upload(transcriber, webm as Uint8Array<ArrayBuffer>, { origin: "https://attacker.example" });
    expect(crossSite.status).toBe(403);
    expect(transcriber).not.toHaveBeenCalled();
  });

  it("accepts only POST", async () => {
    const handler = createTranscriptionHandler({ database: connection.db, auth, transcriber: scripted() });
    expect((await handler(new Request(`${origin}/api/transcriptions`, { headers: { cookie } }))).status).toBe(405);
  });

  it("rejects oversized audio before transcribing", async () => {
    const transcriber = scripted();
    const oversized = new Uint8Array(MAX_AUDIO_BYTES + 1);
    oversized.set(webm);
    const declared = await upload(transcriber, oversized as Uint8Array<ArrayBuffer>);
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "audio_too_large" });
    // A stream without a declared length is counted while it is read.
    const streamed = await upload(transcriber, new Blob([oversized]).stream(), { "content-length": "" });
    expect(streamed.status).toBe(413);
    expect(transcriber).not.toHaveBeenCalled();
  });

  it("rejects unsupported and empty audio", async () => {
    const transcriber = scripted();
    const image = await upload(transcriber, png as Uint8Array<ArrayBuffer>, { "content-type": "audio/webm" });
    expect(image.status).toBe(415);
    expect(await image.json()).toEqual({ error: "unsupported_audio_type" });
    expect((await upload(transcriber, new Uint8Array() as Uint8Array<ArrayBuffer>)).status).toBe(415);
    expect(transcriber).not.toHaveBeenCalled();
  });

  it("says when dictation is unavailable in this deployment", async () => {
    const response = await upload(null, webm as Uint8Array<ArrayBuffer>);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "transcription_unavailable" });
  });

  it("maps transcription failures to bounded error codes", async () => {
    const cases: [TranscriptionError, number, string][] = [
      [new TranscriptionError("spend_limit_reached"), 503, "spend_limit_reached"],
      [new TranscriptionError("spend_ledger_unavailable"), 503, "transcription_unavailable"],
      [new TranscriptionError("timeout"), 504, "transcription_timeout"],
      [new TranscriptionError("provider_failed"), 502, "transcription_failed"],
      [new TranscriptionError("invalid_response"), 502, "transcription_failed"],
    ];
    for (const [error, status, code] of cases) {
      const response = await upload(scripted(error), webm as Uint8Array<ArrayBuffer>);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: code });
    }
  });

  it("counts transcription cost in the shared Quote AI spend ledger", async () => {
    const ledger = databaseSpendLedger(connection.db);
    const before = await reservedSpendNanoUsd(connection.db);
    const fetch = vi.fn(async () => Response.json({
      candidates: [{ content: { parts: [{ text: "Bonjour." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 3, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 100 }] },
    }));
    const env = { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-2.5-flash", GEMINI_API_KEY: "test-key", QUOTE_AI_SPEND_LIMIT_USD: usd(before + 100_000_000_000) };

    const response = await upload(configuredTranscriber(env, { fetch, ledger }), webm as Uint8Array<ArrayBuffer>);

    expect(response.status).toBe(200);
    // gemini-2.5-flash: $0.30/M input (audio at 7x), $2.50/M output.
    expect(await reservedSpendNanoUsd(connection.db)).toBe(before + 100 * 300 + 100 * 2_100 + 3 * 2_500);
  });

  it("refuses before sending audio once the shared limit is reached", async () => {
    const ledger = databaseSpendLedger(connection.db);
    const before = await reservedSpendNanoUsd(connection.db);
    const fetch = vi.fn(async () => Response.json({}));
    const env = { QUOTE_AI_PROVIDER: "google", QUOTE_AI_MODEL: "gemini-2.5-flash", GEMINI_API_KEY: "test-key", QUOTE_AI_SPEND_LIMIT_USD: usd(before + 1) };

    const response = await upload(configuredTranscriber(env, { fetch, ledger }), webm as Uint8Array<ArrayBuffer>);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "spend_limit_reached" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await reservedSpendNanoUsd(connection.db)).toBe(before);
  });
});
