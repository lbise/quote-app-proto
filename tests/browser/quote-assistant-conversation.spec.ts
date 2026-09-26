import type { Page } from "@playwright/test";
import type { QuoteData } from "../../app/lib/quote";
import type { QuoteRecord } from "../../app/components/quotes/use-quote";
import { createConversationQuote, createLongConversationQuote, expect, setInterfaceLanguage, test } from "./fixtures";

type Locale = "en" | "fr";
type AssistantPayload = { action?: string; requestId: string; text: string; locale: Locale };

const copy = {
  en: {
    message: "Your message",
    undo: "Undo last change",
    changed: "Changed",
    changedCount: "lines changed",
    view: "View in Quote",
    edit: "Edit line 4",
    clarification: "Do you mean the unit price of the cladding in Séjour, line 1, Chambre, line 2, or both? No changes applied.",
    copyExplanation: "Copied Chambre to Bureau. Kept the cladding unit m² and unit price CHF 40.00, left its quantity blank because the wall area is unknown, and kept the tablet's fixed amount of CHF 150.00.",
    quantityMissing: "Quantity missing",
    changeExplanation: "Changed the unit prices on lines 1 and 2 from CHF 40.00 to CHF 45.00 per m². Kept quantities of 12 m² and 8 m². Line 3 is unchanged.",
    undoNote: "Last change undone. Earlier messages describe the previous state.",
    fallback: "Nothing from this turn was saved. Delete the work manually instead.",
  },
  fr: {
    message: "Votre message",
    undo: "Annuler la dernière modification",
    changed: "Modifié",
    changedCount: "lignes modifiées",
    view: "Voir dans le devis",
    edit: "Modifier la ligne 4",
    clarification: "Voulez-vous passer le prix unitaire de l'habillage à 45 CHF dans Séjour, ligne 1, dans Chambre, ligne 2, ou dans les deux ? Aucune modification appliquée.",
    copyExplanation: "Chambre copiée dans Bureau. Unité m² et prix unitaire de l'habillage de 40.00 CHF conservés, quantité laissée vide car la surface est inconnue, et forfait de la tablette de 150.00 CHF conservé.",
    quantityMissing: "Quantité manquante",
    changeExplanation: "Prix unitaires des lignes 1 et 2 passés de 40.00 CHF à 45.00 CHF par m². Quantités conservées : 12 m² et 8 m². La ligne 3 est inchangée.",
    undoNote: "Dernière modification annulée. Les messages précédents décrivent l'état antérieur.",
    fallback: "Aucune modification de ce tour n’a été enregistrée. Supprimez les travaux avec les contrôles manuels."
  },
} as const;

function assistantResult(record: QuoteRecord, payload: AssistantPayload, draft: QuoteData, message: { fr: string; en: string }, changed: string[] = [], changedFields: string[] = [], canUndo = record.canUndo): QuoteRecord {
  return {
    ...structuredClone(record),
    version: record.version + 1,
    draft,
    messages: [
      ...record.messages,
      { role: "artisan", fr: payload.text, en: payload.text },
      { role: "assistant", ...message, changed, ...(changedFields.length ? { changedFields } : {}) },
    ],
    pending: false,
    canUndo,
    assistantRequest: { requestId: payload.requestId, text: payload.text, status: "complete", baseVersion: record.version },
  };
}

async function readQuote(page: Page, id: string): Promise<QuoteRecord> {
  const response = await page.request.get(`/api/quotes?id=${id}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<QuoteRecord>;
}

function copiedDraft(draft: QuoteData): QuoteData {
  return {
    ...structuredClone(draft),
    sections: [...draft.sections, { id: "section-office", title: "Bureau" }],
    lines: [
      ...draft.lines,
      { id: "office-cladding", sectionId: "section-office", description: "Habillage mural en chêne", mode: "quantity", quantity: "", unit: "m²", unitPrice: "40.00", amount: "" },
      { id: "office-shelf", sectionId: "section-office", description: "Pose de la tablette, fixations comprises", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "150.00" },
    ],
  };
}

for (const locale of ["en", "fr"] as const) {
  test(`an ambiguous conversational correction leaves the Working Draft and Undo target unchanged in ${locale}`, async ({ artisan }) => {
    const seeded = await createConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const initial = await readQuote(page, seeded.id);
    expect(initial.canUndo).toBe(true);
    let requests = 0;

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action !== "assistant") return route.continue();
      requests += 1;
      expect(payload.locale).toBe(locale);
      await route.fulfill({ json: assistantResult(initial, payload, structuredClone(initial.draft!), { fr: copy.fr.clarification, en: copy.en.clarification }) });
    });

    const composer = page.getByLabel(copy[locale].message);
    await composer.fill("Change the cladding to 45.");
    await composer.press("Control+Enter");
    await expect(composer).toHaveValue("Change the cladding to 45.\n");
    expect(requests).toBe(0);
    await composer.press("Shift+Enter");
    await expect(composer).toHaveValue("Change the cladding to 45.\n\n");
    expect(requests).toBe(0);
    await composer.press("Enter");

    await expect(page.getByText(copy[locale].clarification, { exact: true })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(page.getByRole("button", { name: copy[locale].undo, exact: true })).toBeEnabled();
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
    await expect(page.getByTestId("quote-line").nth(0)).toContainText("12 m²");
    await expect(page.getByTestId("quote-line").nth(1)).toContainText("8 m²");
    await expect(page.getByText("CHF 950.00", { exact: true })).toBeVisible();
    await expect(page.getByText(copy[locale].changed, { exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
  });

  test(`a conversational section copy explains retained and unknown values in ${locale}`, async ({ artisan }) => {
    const seeded = await createConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const initial = await readQuote(page, seeded.id);

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action !== "assistant") return route.continue();
      expect(payload.locale).toBe(locale);
      const next = assistantResult(initial, payload, copiedDraft(initial.draft!), { fr: copy.fr.copyExplanation, en: copy.en.copyExplanation }, ["office-cladding", "office-shelf"], ["section:section-office"], true);
      await route.fulfill({ json: next });
    });

    const composer = page.getByLabel(copy[locale].message);
    await composer.fill("Copy Chambre to Bureau with the same work and prices, but I don't know the wall area yet.");
    await composer.press("Enter");

    await expect(page.getByText(copy[locale].copyExplanation, { exact: true })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(page.getByText(`2 ${copy[locale].changedCount}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Bureau/ })).toBeVisible();
    // The unknown wall area stays visibly missing next to the retained unit.
    await expect(page.getByTestId("quote-line").nth(3)).toContainText(`${copy[locale].quantityMissing} m²`);
    await expect(page.getByTestId("quote-line").nth(3)).toContainText("40.00");
    await expect(page.getByTestId("quote-line").nth(4)).toContainText("150.00");
    await expect(page.getByText("Sous-total partiel HT", { exact: true })).toBeVisible();
    await expect(page.getByText("Total à compléter", { exact: true })).toBeVisible();
    await expect(page.getByText(/CHF 1[’\s]100\.00/, { exact: true })).toBeVisible();

    const view = page.getByRole("button", { name: copy[locale].view, exact: true });
    await view.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: copy[locale].edit, exact: true })).toBeFocused();
  });

  test(`a targeted conversational deletion is visible and manually undoable in ${locale}`, async ({ artisan }) => {
    const seeded = await createConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const initial = await readQuote(page, seeded.id);
    let current = initial;

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action === "assistant") {
        const draft = structuredClone(initial.draft!);
        draft.lines = draft.lines.filter((line) => line.id !== "living-cladding");
        current = assistantResult(initial, payload, draft, { fr: "La ligne ciblée a été supprimée.", en: "The selected line was deleted." }, ["living-cladding"], [], true);
        await route.fulfill({ json: current });
        return;
      }
      if (payload?.action === "undo") {
        current = { ...structuredClone(initial), version: current.version + 1, messages: [...initial.messages, { role: "note", fr: copy[locale].undoNote, en: copy[locale].undoNote }], pending: false, canUndo: false };
        await route.fulfill({ json: current });
        return;
      }
      await route.continue();
    });

    const composer = page.getByLabel(copy[locale].message);
    await composer.fill("Delete the selected living-room cladding line.");
    await composer.press("Enter");
    await expect(page.getByTestId("quote-line")).toHaveCount(2);
    await expect(page.getByRole("button", { name: copy[locale].undo, exact: true })).toBeEnabled();

    await page.getByRole("button", { name: copy[locale].undo, exact: true }).click();
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
    await expect(page.getByText(copy[locale].undoNote, { exact: true })).toBeVisible();
  });

  test(`a targeted deletion preserves long multiline content through manual Undo in ${locale}`, async ({ artisan }) => {
    const seeded = await createLongConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const initial = await readQuote(page, seeded.id);
    const target = initial.draft!.lines.find((line) => line.id === "joinery-02")!;
    let current = initial;

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action === "assistant") {
        const draft = structuredClone(initial.draft!);
        draft.lines = draft.lines.filter((line) => line.id !== target.id);
        current = assistantResult(initial, payload, draft, { fr: "La ligne ciblée a été supprimée.", en: "The selected line was deleted." }, [target.id], [], true);
        await route.fulfill({ json: current });
        return;
      }
      if (payload?.action === "undo") {
        current = { ...structuredClone(initial), version: current.version + 1, messages: [...initial.messages, { role: "note", fr: copy[locale].undoNote, en: copy[locale].undoNote }], pending: false, canUndo: false };
        await route.fulfill({ json: current });
        return;
      }
      await route.continue();
    });

    const targetLine = page.getByTestId("quote-line").filter({ hasText: "Meuble bas sur mesure en mélaminé chêne naturel" });
    await expect(targetLine).toHaveCount(1);
    await expect(targetLine).toContainText("Comprend la livraison, l'ajustement des façades et le nettoyage final.");

    const composer = page.getByLabel(copy[locale].message);
    await composer.fill("Delete the selected kitchen cabinet line.");
    await composer.press("Enter");
    await expect(page.getByTestId("quote-line")).toHaveCount(initial.draft!.lines.length - 1);
    await expect(page.getByTestId("quote-line").filter({ hasText: "Meuble bas sur mesure en mélaminé chêne naturel" })).toHaveCount(0);

    await page.getByRole("button", { name: copy[locale].undo, exact: true }).click();
    await expect(page.getByTestId("quote-line")).toHaveCount(initial.draft!.lines.length);
    await expect(page.getByTestId("quote-line").filter({ hasText: "Meuble bas sur mesure en mélaminé chêne naturel" })).toContainText("Comprend la livraison, l'ajustement des façades et le nettoyage final.");
  });

  test(`a clear edit changes representative long content and remains undoable in ${locale}`, async ({ artisan }) => {
    const seeded = await createLongConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const initial = await readQuote(page, seeded.id);
    const target = initial.draft!.lines.find((line) => line.id === "joinery-02")!;
    const updatedDescription = `${target.description}\nFinition ajustée après relevé.`;
    let current = initial;

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action === "assistant") {
        const draft = structuredClone(initial.draft!);
        draft.lines = draft.lines.map((line) => line.id === target.id ? { ...line, description: updatedDescription } : line);
        current = assistantResult(initial, payload, draft, { fr: "La description longue a été corrigée.", en: "The long description was corrected." }, [target.id], [], true);
        await route.fulfill({ json: current });
        return;
      }
      if (payload?.action === "undo") {
        current = { ...structuredClone(initial), version: current.version + 1, messages: [...initial.messages, { role: "note", fr: copy[locale].undoNote, en: copy[locale].undoNote }], pending: false, canUndo: false };
        await route.fulfill({ json: current });
        return;
      }
      await route.continue();
    });

    const composer = page.getByLabel(copy[locale].message);
    await composer.fill("Add the final adjustment note to the selected kitchen cabinet line.");
    await composer.press("Enter");
    await expect(page.getByTestId("quote-line").filter({ hasText: "Finition ajustée après relevé." })).toHaveCount(1);
    await expect(page.getByText(`1 ${copy[locale].changedCount}`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: copy[locale].undo, exact: true }).click();
    await expect(page.getByTestId("quote-line").filter({ hasText: "Finition ajustée après relevé." })).toHaveCount(0);
    await expect(page.getByTestId("quote-line").filter({ hasText: "Meuble bas sur mesure en mélaminé chêne naturel" })).toContainText("Comprend la livraison, l'ajustement des façades et le nettoyage final.");
  });

  test(`a rejected destructive request leaves work for manual controls in ${locale}`, async ({ artisan }) => {
    const seeded = await createConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action === "assistant") {
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "assistant_unavailable", details: { diagnostic: { phase: "tool", code: "destructive_scope_rejected", outcome: "discarded" } } }) });
        return;
      }
      await route.continue();
    });

    const composer = page.getByLabel(copy[locale].message);
    await composer.fill(locale === "fr" ? "Supprime tout le travail." : "Delete all work.");
    await composer.press("Enter");
    await expect(page.getByText(copy[locale].fallback, { exact: true })).toBeVisible();
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test(`a conversational compound correction is one keyboard-undoable action in ${locale}`, async ({ artisan }) => {
    const seeded = await createConversationQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const initial = await readQuote(page, seeded.id);
    let current = initial;

    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() as AssistantPayload : null;
      if (payload?.action === "assistant") {
        expect(payload.locale).toBe(locale);
        const draft = structuredClone(initial.draft!);
        draft.lines[0].unitPrice = "45.00";
        draft.lines[1].unitPrice = "45.00";
        current = assistantResult(initial, payload, draft, { fr: copy.fr.changeExplanation, en: copy.en.changeExplanation }, ["living-cladding", "bedroom-cladding"], [], true);
        await route.fulfill({ json: current });
        return;
      }
      if (payload?.action === "undo") {
        current = {
          ...structuredClone(initial),
          version: current.version + 1,
          messages: [...current.messages, { role: "note", fr: copy.fr.undoNote, en: copy.en.undoNote }],
          pending: false,
          canUndo: false,
        };
        await route.fulfill({ json: current });
        return;
      }
      await route.continue();
    });

    const composer = page.getByLabel(copy[locale].message);
    const request = "Set the unit price of both wall-cladding lines to CHF 45 per m².";
    await composer.fill(request);
    await composer.press("Enter");

    await expect(page.getByText(copy[locale].changeExplanation, { exact: true })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(page.getByText(`2 ${copy[locale].changedCount}`, { exact: true })).toBeVisible();
    await expect(page.getByText(copy[locale].changed, { exact: true })).toHaveCount(2);
    await expect(page.getByTestId("quote-line").nth(0)).toContainText("45.00");
    await expect(page.getByTestId("quote-line").nth(1)).toContainText("45.00");
    await expect(page.getByText("CHF 1’050.00", { exact: true })).toBeVisible();

    const undo = page.getByRole("button", { name: copy[locale].undo, exact: true });
    await undo.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText(request, { exact: true })).toBeVisible();
    await expect(page.getByText(copy[locale].changeExplanation, { exact: true })).toBeVisible();
    await expect(page.getByText(copy[locale].undoNote, { exact: true })).toBeVisible();
    await expect(page.getByTestId("quote-line").nth(0)).toContainText("40.00");
    await expect(page.getByTestId("quote-line").nth(1)).toContainText("40.00");
    await expect(page.getByText("CHF 950.00", { exact: true })).toBeVisible();
    await expect(page.getByText(copy[locale].changed, { exact: true })).toHaveCount(0);
    await expect(undo).toBeDisabled();
  });
}
