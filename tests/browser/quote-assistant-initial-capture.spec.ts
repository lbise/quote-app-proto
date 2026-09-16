import type { QuoteData } from "../../app/lib/quote";
import type { QuoteRecord } from "../../app/components/quotes/use-quote";
import { createEmptyQuote, expect, setInterfaceLanguage, test } from "./fixtures";

type Locale = "en" | "fr";
type AssistantPayload = { action?: string; requestId: string; text: string; locale: Locale };

const frenchWork = "Pose d’une porte intérieure en chêne. Dimensions et prix à préciser.";
const clarification = {
  fr: "J’ai ajouté la porte. Quelle quantité et quel prix souhaitez-vous retenir ?",
  en: "I added the door. What quantity and price should I use?",
};

function labels(locale: Locale) {
  return locale === "fr"
    ? { message: "Votre message", send: "Envoyer le message", retry: "Réessayer", undo: "Annuler", saved: "Enregistré", changed: "Modifié", changedCount: "lignes modifiées" }
    : { message: "Your message", send: "Send message", retry: "Retry", undo: "Undo", saved: "Saved", changed: "Changed", changedCount: "lines changed" };
}

function capturedLine(): QuoteData["lines"][number] {
  return {
    id: "ai-door",
    sectionId: "",
    description: "Fourniture et pose d’une porte intérieure en chêne.",
    mode: "quantity",
    quantity: "",
    unit: "",
    unitPrice: "",
    amount: "",
  };
}

function assistantResult(record: QuoteRecord, payload: AssistantPayload, draft: QuoteData, message: { fr: string; en: string }, changed: string[]): QuoteRecord {
  return {
    ...structuredClone(record),
    version: record.version + 1,
    draft,
    messages: [
      ...record.messages,
      { role: "artisan", fr: payload.text, en: payload.text },
      { role: "assistant", ...message, changed },
    ],
    pending: false,
    canUndo: true,
    assistantRequest: { requestId: payload.requestId, text: payload.text, status: "complete", baseVersion: record.version },
  };
}

async function selectInterfaceLanguage(page: import("@playwright/test").Page, locale: Locale) {
  if (locale === "en") return;
  await setInterfaceLanguage(page, locale);
}

async function sendFirstMessage(page: import("@playwright/test").Page, locale: Locale, text: string) {
  const textLabels = labels(locale);
  await page.getByLabel(textLabels.message).fill(text);
  await page.getByRole("button", { name: textLabels.send }).click();
}

for (const locale of ["en", "fr"] as const) {
  test(`an Artisan captures incomplete French work and clarifies it in the ${locale} interface without administrative details`, async ({ artisan }) => {
    const seeded = await createEmptyQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    const initial = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json() as QuoteRecord;
    expect(initial.draft?.customerName).toBe("");
    expect(initial.draft?.businessName).toBe("");
    await selectInterfaceLanguage(page, locale);

    const requests: AssistantPayload[] = [];
    let current = initial;
    await page.route("**/api/quotes**", async (route) => {
      if (route.request().method() !== "POST") {
        if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("id") === seeded.id) {
          await route.fulfill({ json: current });
          return;
        }
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON() as AssistantPayload;
      if (payload.action !== "assistant") {
        await route.continue();
        return;
      }
      requests.push(payload);
      if (requests.length === 1) {
        current = assistantResult(current, payload, { ...current.draft!, lines: [capturedLine()] }, clarification, ["ai-door"]);
      } else {
        const completeLine = { ...capturedLine(), quantity: "1", unit: "pce", unitPrice: "850.00" };
        current = assistantResult(current, payload, { ...current.draft!, lines: [completeLine] }, {
          fr: "La porte est chiffrée à 850 CHF.",
          en: "The door is priced at CHF 850.",
        }, ["ai-door"]);
      }
      await route.fulfill({ json: current });
    });

    await sendFirstMessage(page, locale, frenchWork);
    await expect(page.getByText(clarification[locale], { exact: true })).toBeVisible();
    await expect(page.getByTestId("quote-line")).toContainText("À compléter");
    await expect(page.getByTestId("quote-line")).toContainText("—");
    expect(requests[0]).toMatchObject({ text: frenchWork, locale });

    const textLabels = labels(locale);
    await page.getByLabel(textLabels.message).fill("Une porte, 850 CHF.");
    await page.getByRole("button", { name: textLabels.send }).click();
    await expect(page.getByText(locale === "fr" ? "La porte est chiffrée à 850 CHF." : "The door is priced at CHF 850.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("quote-line")).toContainText("1 pce");
    await expect(page.getByTestId("quote-line")).toContainText("850.00");
    expect(requests[1]).toMatchObject({ text: "Une porte, 850 CHF.", locale });
  });

  test(`assistant compound changes are visible, undoable, and available after reopening in the ${locale} interface`, async ({ artisan }) => {
    const seeded = await createEmptyQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    const initial = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json() as QuoteRecord;
    await selectInterfaceLanguage(page, locale);

    let current = initial;
    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        if (new URL(request.url()).searchParams.get("id") === seeded.id) {
          await route.fulfill({ json: current });
          return;
        }
        await route.continue();
        return;
      }
      const payload = request.postDataJSON() as AssistantPayload;
      if (payload.action === "assistant") {
        const lines = [
          { ...capturedLine(), id: "ai-door" },
          { ...capturedLine(), id: "ai-handle", description: "Fourniture et pose d’une poignée en laiton." },
        ];
        current = assistantResult(current, payload, { ...current.draft!, lines }, {
          fr: "J’ai ajouté la porte et la poignée.",
          en: "I added the door and the handle.",
        }, lines.map((line) => line.id));
        await route.fulfill({ json: current });
        return;
      }
      if (payload.action === "undo") {
        current = {
          ...structuredClone(initial),
          version: current.version + 1,
          messages: [...current.messages, { role: "note", fr: "Dernière modification annulée.", en: "Latest change undone." }],
          canUndo: false,
        };
        await route.fulfill({ json: current });
        return;
      }
      await route.continue();
    });

    await sendFirstMessage(page, locale, "Ajoutez une porte et une poignée en laiton.");
    const textLabels = labels(locale);
    await expect(page.getByText(`2 ${textLabels.changedCount}`, { exact: true })).toBeVisible();
    await expect(page.getByText(textLabels.changed, { exact: true })).toHaveCount(2);
    await expect(page.getByTestId("quote-line").nth(0)).toContainText("porte intérieure en chêne");
    await expect(page.getByTestId("quote-line").nth(1)).toContainText("poignée en laiton");
    await expect(page.getByRole("status")).toContainText(textLabels.saved);

    await page.goto(`/quotes?id=${seeded.id}`);
    await expect(page.getByText(locale === "fr" ? "J’ai ajouté la porte et la poignée." : "I added the door and the handle.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("quote-line")).toHaveCount(2);

    await page.getByRole("button", { name: textLabels.undo }).click();
    await expect(page.getByTestId("quote-line")).toHaveCount(0);
    await expect(page.getByText(locale === "fr" ? "Dernière modification annulée." : "Latest change undone.", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("quote-line")).toHaveCount(0);
    await expect(page.getByText(locale === "fr" ? "Dernière modification annulée." : "Latest change undone.", { exact: true })).toBeVisible();
  });

  test(`assistant failure exposes an idempotent retry in the ${locale} interface`, async ({ artisan }) => {
    const seeded = await createEmptyQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    const initial = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json() as QuoteRecord;
    await selectInterfaceLanguage(page, locale);

    const requests: AssistantPayload[] = [];
    let current = initial;
    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = request.postDataJSON() as AssistantPayload;
      if (payload.action !== "assistant") {
        await route.continue();
        return;
      }
      requests.push(payload);
      if (requests.length === 1) {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "assistant_unavailable" }) });
        return;
      }
      const line = { ...capturedLine(), mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "850.00" };
      current = assistantResult(current, payload, { ...current.draft!, lines: [line] }, {
        fr: "La porte a été ajoutée.",
        en: "The door was added.",
      }, [line.id]);
      await route.fulfill({ json: current });
    });

    await sendFirstMessage(page, locale, frenchWork);
    await expect(page.getByRole("alert")).toContainText(locale === "fr" ? "L’assistant n’a pas répondu" : "The assistant did not respond");
    await page.getByRole("button", { name: labels(locale).retry }).click();
    await expect(page.getByText(locale === "fr" ? "La porte a été ajoutée." : "The door was added.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("quote-line")).toHaveCount(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ text: frenchWork, locale });
    expect(requests[1]).toMatchObject({ text: frenchWork, locale, requestId: requests[0].requestId });
  });
}
