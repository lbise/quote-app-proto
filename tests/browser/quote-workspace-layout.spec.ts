import type { Locator, Page } from "@playwright/test";
import type { QuoteRecord } from "../../app/components/quotes/use-quote";
import { createCompleteQuote, createLongConversationQuote, expect, setInterfaceLanguage, test } from "./fixtures";

const preferenceKey = "easy-quote-assistant-collapsed";
const interfaces = {
  en: {
    hide: "Hide assistant", show: "Show assistant", conversation: "Conversation with assistant",
    message: "Your message", send: "Send message", privacy: "Assistant data and privacy",
    quote: "Quote", document: "Customer-facing Quote", scroll: "Scrollable Quote content", jump: "Jump to", total: "Quote total",
    edit: "Edit", editLine: "Edit line 1", more: "More actions for line 1",
    addToQuote: "Add to Quote", addSection: "Add section", addLine: "Add a line",
    details: ["Edit reference and dates", "Edit Quote title", "Edit site address", "Edit business details", "Choose or edit Customer", "Edit terms"],
    publish: "Review & publish", confirm: "Confirm publication", published: "Published revision 1", close: "Close",
  },
  fr: {
    hide: "Masquer l’assistant", show: "Afficher l’assistant", conversation: "Conversation avec l’assistant",
    message: "Votre message", send: "Envoyer le message", privacy: "Données envoyées à l’assistant",
    quote: "Devis", document: "Devis destiné au client", scroll: "Contenu du devis, défilant", jump: "Aller à", total: "Total du devis",
    edit: "Modifier", editLine: "Modifier la ligne 1", more: "Autres actions de la ligne 1",
    addToQuote: "Ajouter au devis", addSection: "Ajouter une section", addLine: "Ajouter une ligne",
    details: ["Modifier la référence et les dates", "Modifier l’objet du devis", "Modifier l’adresse du chantier", "Modifier les coordonnées de l’entreprise", "Choisir ou modifier le client", "Modifier les conditions"],
    publish: "Relire et publier", confirm: "Confirmer la publication", published: "Révision publiée 1", close: "Fermer",
  },
} as const;

async function preference(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), preferenceKey);
}

async function expectInViewport(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeInViewport({ ratio: 1 });
}

for (const locale of ["en", "fr"] as const) {
  const copy = interfaces[locale];

  test(`assistant collapse preserves conversation and unsent text, transfers focus, and remembers the preference in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await page.setViewportSize({ width: 1440, height: 960 });
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    const assistant = page.locator("#qp-assistant");
    const hide = page.getByRole("button", { name: copy.hide, exact: true });
    const show = page.getByRole("button", { name: copy.show, exact: true });
    const composer = page.getByRole("textbox", { name: copy.message, exact: true });
    const documentPane = page.getByRole("region", { name: copy.document, exact: true });
    await expect(assistant).toBeVisible();
    await expect(hide).toHaveAttribute("aria-controls", "qp-assistant");
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(show).toHaveCount(0);
    const openWidth = (await documentPane.boundingBox())!.width;

    // Only the assistant turn is faked. The Quote belongs to this isolated fixture account.
    const response = await page.request.get(`/api/quotes?id=${seeded.id}`);
    expect(response.ok()).toBe(true);
    const initial = await response.json() as QuoteRecord;
    const sent = "Keep the oak finish already specified.";
    const answer = "The oak finish is unchanged.";
    let assistantRequests = 0;
    await page.route("**/api/quotes**", async (route) => {
      const request = route.request();
      const payload = request.method() === "POST" ? request.postDataJSON() : null;
      if (payload?.action !== "assistant") return route.continue();
      assistantRequests += 1;
      await route.fulfill({ json: {
        ...initial,
        version: initial.version + 1,
        messages: [...initial.messages, { role: "artisan", fr: sent, en: sent }, { role: "assistant", fr: answer, en: answer }],
        pending: false,
        assistantRequest: { requestId: payload.requestId, text: payload.text, status: "complete", baseVersion: initial.version },
      } });
    });
    await composer.fill(sent);
    await composer.press("Enter");
    await expect(assistant.getByText(answer, { exact: true })).toBeVisible();
    const unsent = "Leave this correction unsent.\nCheck the measurements first.";
    await composer.fill(unsent);

    await hide.focus();
    await hide.press("Enter");
    await expect(show).toBeFocused();
    await expect(show).toHaveAttribute("aria-controls", "qp-assistant");
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(assistant).toBeHidden();
    await expect(page.getByRole("region", { name: copy.conversation, exact: true })).toHaveCount(0);
    await expect(composer).toHaveCount(0);
    for (const name of [copy.hide, copy.send, copy.privacy]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    // A hidden composer must not steal focus, even if code attempts to focus it.
    await assistant.locator("textarea").evaluate((element) => element.focus());
    await expect(show).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await assistant.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    await expect.poll(() => preference(page)).toBe("true");
    await expect.poll(async () => (await documentPane.boundingBox())!.width).toBeGreaterThan(openWidth);

    await show.focus();
    await show.press("Enter");
    await expect(assistant).toBeVisible();
    await expect(assistant.locator(":focus")).toHaveCount(1);
    await expect(assistant.locator(":focus")).toBeVisible();
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(composer).toHaveValue(unsent);
    await expect(assistant.getByText(sent, { exact: true })).toBeVisible();
    await expect(assistant.getByText(answer, { exact: true })).toBeVisible();
    await expect.poll(() => preference(page)).toBe("false");
    expect(assistantRequests).toBe(1);

    await hide.click();
    await expect.poll(() => preference(page)).toBe("true");
    await page.reload();
    await expect(show).toBeVisible();
    await expect(assistant).toBeHidden();
    await show.click();
    await expect(composer).toHaveValue("");
    await expect.poll(() => preference(page)).toBe("false");
    await page.reload();
    await expect(hide).toBeVisible();
    await expect(composer).toBeVisible();
    expect(assistantRequests).toBe(1);
  });

  test(`line controls share the content row on desktop and the pricing row on phone in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/quotes?id=${seeded.id}`);
    const line = page.getByTestId("quote-line").first();
    const description = line.locator(".qp-line-description");
    const pricing = line.locator(".qp-line-pricing");
    const actions = line.locator(".qp-line-actions");
    const edit = line.getByRole("button", { name: copy.editLine, exact: true });
    const menu = line.getByRole("button", { name: copy.more, exact: true });
    await expect(actions).toBeVisible();
    let [descriptionBox, pricingBox, actionsBox] = await Promise.all([description.boundingBox(), pricing.boundingBox(), actions.boundingBox()]);
    expect(Math.abs(descriptionBox!.y - actionsBox!.y)).toBeLessThan(2);
    expect(Math.abs(pricingBox!.y - actionsBox!.y)).toBeLessThan(2);
    expect(actionsBox!.x).toBeGreaterThan(pricingBox!.x + pricingBox!.width - 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("radio", { name: copy.quote, exact: true }).click();
    [descriptionBox, pricingBox, actionsBox] = await Promise.all([description.boundingBox(), pricing.boundingBox(), actions.boundingBox()]);
    expect(actionsBox!.y).toBeGreaterThanOrEqual(descriptionBox!.y + descriptionBox!.height - 1);
    expect(Math.abs(pricingBox!.y - actionsBox!.y)).toBeLessThan(2);
    expect(actionsBox!.x).toBeGreaterThan(pricingBox!.x + pricingBox!.width - 1);
    expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual((await line.boundingBox())!.x + (await line.boundingBox())!.width + 1);
    for (const control of [edit, menu]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    if (locale === "en") await expect(line).toHaveScreenshot("quote-line-phone.png", { animations: "disabled" });
    await page.setViewportSize({ width: 320, height: 740 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await menu.focus();
    await menu.press("Enter");
    await expect(page.getByRole("menuitem", { name: new RegExp(locale === "fr" ? "Dupliquer la ligne 1" : "Duplicate line 1") })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await edit.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test(`document pencils are visible without hover, retain accessible names and disappear on publication in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await page.setViewportSize({ width: 1440, height: 960 });
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);
    await page.mouse.move(0, 0);
    const documentPane = page.getByRole("region", { name: copy.document, exact: true });
    await expect(documentPane.locator(".qp-edit-target")).toHaveCount(copy.details.length);
    for (const name of copy.details) {
      const target = documentPane.getByRole("button", { name, exact: true });
      await expect(target).toHaveAccessibleName(name);
      const pencil = target.locator(".qp-edit-affordance");
      await expect(pencil).toHaveText("");
      await expect(pencil).toHaveAttribute("aria-hidden", "true");
      await expect(pencil).toBeVisible();
      await expect(pencil).toHaveCSS("opacity", "1");
      await expect(pencil.locator("svg")).toBeVisible();
    }
    const editLine = documentPane.getByRole("button", { name: copy.editLine, exact: true });
    await expect(editLine).toHaveAccessibleName(copy.editLine);
    await expect(editLine).toHaveText("");
    await expect(editLine.locator("svg")).toBeVisible();
    await expect(editLine).toHaveCSS("opacity", "1");
    await expect(documentPane.getByText(copy.edit, { exact: true })).toHaveCount(0);
    await expect(documentPane.getByRole("button", { name: copy.more, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.addToQuote, exact: true })).toBeVisible();
    await expect(documentPane.getByRole("button", { name: copy.addSection, exact: true })).toHaveCount(1);
    await expect(documentPane.getByRole("button", { name: copy.addLine, exact: true })).toBeVisible();

    await page.getByRole("button", { name: copy.publish, exact: true }).click();
    await page.getByRole("button", { name: copy.confirm, exact: true }).click();
    await expect(page.getByText(copy.published, { exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: copy.close, exact: true }).click();
    await expect(documentPane.locator(".qp-edit-target, .qp-edit-affordance")).toHaveCount(0);
    await expect(documentPane.getByRole("button", { name: copy.editLine, exact: true })).toHaveCount(0);
    await expect(documentPane.getByRole("button", { name: copy.more, exact: true })).toHaveCount(0);
    for (const name of [...copy.details, copy.addToQuote, copy.addSection, copy.addLine]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    await expect(documentPane.getByText("Bibliothèque en chêne avec fixations invisibles.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(copy.published, { exact: true })).toBeVisible();
    await expect(documentPane.locator(".qp-edit-target, .qp-edit-affordance")).toHaveCount(0);
    for (const name of [...copy.details, copy.editLine, copy.more, copy.addToQuote, copy.addSection, copy.addLine]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
  });
}

for (const method of ["getItem", "setItem"] as const) {
  test(`assistant collapse remains usable when localStorage.${method} fails`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ key, method }) => {
      const original = Storage.prototype[method];
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: function (this: Storage, storageKey: string, ...args: string[]) {
          if (storageKey === key) throw new DOMException("Storage unavailable", "SecurityError");
          return Reflect.apply(original, this, [storageKey, ...args]);
        },
      });
    }, { key: preferenceKey, method });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/quotes?id=${seeded.id}`);
    const composer = page.getByRole("textbox", { name: "Your message", exact: true });
    await composer.fill("An unsent correction survives unavailable storage.");
    await page.getByRole("button", { name: "Hide assistant", exact: true }).click();
    await expect(page.locator("#qp-assistant")).toBeHidden();
    await page.getByRole("button", { name: "Show assistant", exact: true }).click();
    await expect(composer).toHaveValue("An unsent correction survives unavailable storage.");
    await page.getByRole("button", { name: "Hide assistant", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Hide assistant", exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
    expect(errors).toEqual([]);
  });
}

for (const { locale, width, height } of [
  { locale: "en", width: 390, height: 844 },
  { locale: "fr", width: 844, height: 390 },
  { locale: "en", width: 1000, height: 768 },
] as const) {
  test(`narrow panels keep the last section, tabs and total reachable at ${width}×${height} in ${locale}`, async ({ artisan }) => {
    // This long-Quote helper retains each new Quote's generated reference.
    const seeded = await createLongConversationQuote(artisan);
    const { page } = artisan;
    const copy = interfaces[locale];
    await setInterfaceLanguage(page, locale);
    await page.evaluate((key) => localStorage.setItem(key, "true"), preferenceKey);
    await page.setViewportSize({ width, height });
    await page.goto(`/quotes?id=${seeded.id}`);

    const conversationTab = page.getByRole("radio", { name: "Conversation", exact: true });
    const quoteTab = page.getByRole("radio", { name: copy.quote, exact: true });
    const composer = page.getByRole("textbox", { name: copy.message, exact: true });
    const documentPane = page.getByRole("region", { name: copy.document, exact: true });
    await expect(conversationTab).toHaveAttribute("aria-checked", "true");
    await expect(quoteTab).toHaveAttribute("aria-checked", "false");
    await expect(composer).toBeVisible();
    await expect(documentPane).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.hide, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.show, exact: true })).toHaveCount(0);
    await composer.fill("Keep this mobile correction unsent.");

    await quoteTab.click();
    await expect(quoteTab).toHaveAttribute("aria-checked", "true");
    await expect(conversationTab).toHaveAttribute("aria-checked", "false");
    await expect(composer).toHaveCount(0);
    const scroller = page.getByRole("region", { name: copy.scroll, exact: true });
    const jump = page.getByRole("combobox", { name: copy.jump, exact: true });
    const total = documentPane.locator(".qp-document-bottom");
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    await jump.selectOption({ label: "Buanderie" });
    await expect(jump).toHaveValue("joinery-laundry");
    await expect(page.getByRole("heading", { name: "Buanderie", exact: true })).toBeInViewport();
    for (const control of [conversationTab, quoteTab, jump, total]) await expectInViewport(control);
    await expect(total).toContainText(copy.total);
    await expect(total).toContainText("CHF");
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    // Preserve a position within the document, not merely the selected section's anchor.
    await scroller.evaluate((element) => { element.scrollTop += 32; });
    const scrollTop = await scroller.evaluate((element) => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);

    // Switching panels must not recreate the document at the beginning of the Quote.
    await conversationTab.click();
    await expect(conversationTab).toHaveAttribute("aria-checked", "true");
    await expect(quoteTab).toHaveAttribute("aria-checked", "false");
    await expect(composer).toHaveValue("Keep this mobile correction unsent.");
    await expectInViewport(composer);
    await expect(documentPane).toHaveCount(0);
    await quoteTab.click();
    await expect(quoteTab).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => Math.abs(await scroller.evaluate((element) => element.scrollTop) - scrollTop)).toBeLessThanOrEqual(1);
    await expect(jump).toHaveValue("joinery-laundry");
    for (const control of [conversationTab, quoteTab, jump, total]) await expectInViewport(control);
    expect(await preference(page)).toBe("true");

    // The same preference applies again only after returning to desktop width.
    await page.setViewportSize({ width: 1440, height: 960 });
    await expect(page.getByRole("button", { name: copy.show, exact: true })).toBeVisible();
    await expect(page.locator("#qp-assistant")).toBeHidden();
  });
}
