import type { Page, Route } from "@playwright/test";
import { createCompleteQuote, expect, setInterfaceLanguage, test } from "./fixtures";

// Browser tests fake the microphone and MediaRecorder, and the transcription
// endpoint. No audio is captured and no provider is called.
async function fakeMicrophone(page: Page, permission: "granted" | "denied" = "granted") {
  await page.addInitScript((initialPermission) => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
    const control = { permission: initialPermission, tracks: [] as EventTarget[] };
    (window as unknown as { __dictation: typeof control }).__dictation = control;
    class FakeTrack extends EventTarget { kind = "audio"; stop() {} }
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      async getUserMedia() {
        if (control.permission === "denied") throw new DOMException("Permission denied", "NotAllowedError");
        const track = new FakeTrack();
        control.tracks.push(track);
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    } });
    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported(type: string) { return type.startsWith("audio/webm"); }
      state: "inactive" | "recording" = "inactive";
      mimeType: string;
      constructor(_stream: unknown, options?: { mimeType?: string }) { super(); this.mimeType = options?.mimeType ?? "audio/webm"; }
      private chunk() {
        const event = new Event("dataavailable") as Event & { data: Blob };
        event.data = new Blob([webm], { type: "audio/webm" });
        this.dispatchEvent(event);
      }
      start() { this.state = "recording"; this.chunk(); }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => { this.chunk(); this.dispatchEvent(new Event("stop")); });
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeMediaRecorder });
  }, permission);
}

/** Holds each transcription upload until the test answers it. */
function transcriptionEndpoint(page: Page) {
  const pending: Route[] = [];
  const uploads: { contentType: string | null; bytes: number }[] = [];
  const waiters: (() => void)[] = [];
  void page.route("**/api/transcriptions", async (route) => {
    uploads.push({ contentType: route.request().headers()["content-type"] ?? null, bytes: route.request().postDataBuffer()?.byteLength ?? 0 });
    pending.push(route);
    waiters.splice(0).forEach((resolve) => resolve());
  });
  async function next() {
    if (!pending.length) await new Promise<void>((resolve) => waiters.push(resolve));
    return pending.shift()!;
  }
  return {
    uploads,
    respond: async (text: string) => (await next()).fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text }) }),
    fail: async (status = 502, error = "transcription_failed") => (await next()).fulfill({ status, contentType: "application/json", body: JSON.stringify({ error }) }),
    abandon: async () => { const route = await next(); await route.abort().catch(() => {}); },
  };
}

function assistantRequests(page: Page) {
  const payloads: { text: string; dictation?: { editRatio: number } }[] = [];
  void page.route("**/api/quotes**", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string; text: string; dictation?: { editRatio: number } } | null;
    if (payload?.action !== "assistant") return route.continue();
    payloads.push(payload);
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "assistant_unavailable" }) });
  });
  return payloads;
}

test("dictation appends the transcript to the composer without sending it, and marks the sent message as dictated", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  await fakeMicrophone(page);
  const transcription = transcriptionEndpoint(page);
  const sent = assistantRequests(page);
  await page.goto(`/quotes?id=${seeded.id}`);

  const composer = page.getByLabel("Your message");
  await composer.fill("Salle de bain");
  await page.getByRole("button", { name: "Dictate a message" }).click();
  await expect(page.getByRole("timer", { name: "Recording time" })).toHaveText("0:00");
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop recording" }).click();

  // The composer is locked while the recording is transcribed.
  await expect(page.getByRole("status").filter({ hasText: "Transcription…" })).toBeVisible();
  await expect(composer).not.toBeEditable();
  await expect(composer).toHaveValue("Salle de bain");
  await transcription.respond("ajoute trois portes.");

  await expect(composer).toHaveValue("Salle de bain ajoute trois portes.");
  await expect(composer).toBeEditable();
  expect(transcription.uploads).toEqual([{ contentType: "audio/webm;codecs=opus", bytes: 32 }]);
  expect(sent).toEqual([]);

  // The Artisan reviews and edits the transcript, then sends it manually.
  await composer.fill("Salle de bain : ajoute trois portes.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].text).toBe("Salle de bain : ajoute trois portes.");
  expect(sent[0].dictation!.editRatio).toBeGreaterThan(0);
  expect(sent[0].dictation!.editRatio).toBeLessThan(0.1);

  // A typed message is not marked as dictated.
  await composer.fill("Deux fenêtres.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).not.toHaveProperty("dictation");
});

test("a failed or cancelled transcription keeps the recording in the tab for Retry", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  await fakeMicrophone(page);
  const transcription = transcriptionEndpoint(page);
  await page.goto(`/quotes?id=${seeded.id}`);
  const composer = page.getByLabel("Your message");

  await page.getByRole("button", { name: "Dictate a message" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await transcription.fail();
  const failure = page.getByRole("alert").filter({ hasText: "Transcription failed" });
  await expect(failure).toContainText("The recording is kept in this tab only. Closing or reloading the tab loses it.");
  await expect(composer).toBeEditable();
  await expect(page.getByRole("button", { name: "Dictate a message" })).toBeDisabled();

  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Transcription…" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await transcription.abandon();
  const cancelled = page.getByRole("alert").filter({ hasText: "Transcription cancelled" });
  await expect(cancelled).toContainText("Closing or reloading the tab loses it.");
  await expect(composer).toBeEditable();

  await cancelled.getByRole("button", { name: "Retry" }).click();
  await transcription.respond("Trois portes.");
  await expect(composer).toHaveValue("Trois portes.");
  // Every attempt uploaded the same kept recording.
  expect(transcription.uploads.map((upload) => upload.bytes)).toEqual([32, 32, 32]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an interrupted recording keeps what was captured and offers to transcribe it", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  await fakeMicrophone(page);
  const transcription = transcriptionEndpoint(page);
  await page.goto(`/quotes?id=${seeded.id}`);

  await page.getByRole("button", { name: "Dictate a message" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  // The screen locks or the Artisan switches apps.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const interrupted = page.getByRole("alert").filter({ hasText: "Recording interrupted" });
  await expect(interrupted).toContainText("Closing or reloading the tab loses it.");
  expect(transcription.uploads).toEqual([]);
  await page.evaluate(() => { delete (document as { visibilityState?: unknown }).visibilityState; });

  await interrupted.getByRole("button", { name: "Transcribe" }).click();
  await transcription.respond("Trois portes.");
  await expect(page.getByLabel("Your message")).toHaveValue("Trois portes.");

  // A revoked permission or lost device ends the track the same way.
  await page.getByRole("button", { name: "Dictate a message" }).click();
  await page.evaluate(() => (window as unknown as { __dictation: { tracks: EventTarget[] } }).__dictation.tracks.at(-1)!.dispatchEvent(new Event("ended")));
  await expect(page.getByRole("alert").filter({ hasText: "Recording interrupted" })).toBeVisible();
  await page.getByRole("button", { name: "Discard recording" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("Your message")).toHaveValue("Trois portes.");
});

test("the timer warns at 4:30 and stops the recording at 5:00", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  await fakeMicrophone(page);
  const transcription = transcriptionEndpoint(page);
  await page.clock.install();
  await page.goto(`/quotes?id=${seeded.id}`);

  await page.getByRole("button", { name: "Dictate a message" }).click();
  const timer = page.getByRole("timer", { name: "Recording time" });
  await page.clock.fastForward(62_000);
  await expect(timer).toHaveText("1:02");
  await expect(page.getByText("Recording… 5 min max.")).toBeVisible();

  await page.clock.fastForward(208_000);
  await expect(timer).toHaveText("4:30");
  await expect(page.getByRole("status").filter({ hasText: "Stops automatically in 0:30" })).toBeVisible();

  await page.clock.fastForward(30_000);
  await expect(page.getByRole("status").filter({ hasText: "Transcription…" })).toBeVisible();
  await expect(page.getByText("Recording stopped at 5 minutes.")).toBeVisible();
  await transcription.respond("Trois portes.");
  await expect(page.getByLabel("Your message")).toHaveValue("Trois portes.");
  expect(transcription.uploads).toHaveLength(1);
});

for (const locale of ["en", "fr"] as const) {
  test(`refusing the microphone explains how to re-enable it and typing still works in ${locale}`, async ({ artisan }) => {
    const { page } = artisan;
    const seeded = await createCompleteQuote(artisan);
    await fakeMicrophone(page, "denied");
    await page.goto(`/quotes?id=${seeded.id}`);
    await setInterfaceLanguage(page, locale);
    const copy = locale === "fr"
      ? { dictate: "Dicter un message", blocked: "Accès au microphone refusé", guidance: "autorisez le microphone pour ce site dans les réglages du navigateur", message: "Votre message", send: "Envoyer le message" }
      : { dictate: "Dictate a message", blocked: "Microphone access blocked", guidance: "allow the microphone for this site in your browser settings", message: "Your message", send: "Send message" };

    await page.getByRole("button", { name: copy.dictate }).click();
    const alert = page.getByRole("alert").filter({ hasText: copy.blocked });
    await expect(alert).toContainText(copy.guidance);
    await expect(page.getByRole("button", { name: copy.dictate })).toBeEnabled();

    await page.getByLabel(copy.message).fill("Trois portes.");
    await expect(page.getByRole("button", { name: copy.send })).toBeEnabled();
  });
}
