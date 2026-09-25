import { createCompleteQuote, expect, test } from "./fixtures";

// The browser suite shares an Artisan Business across tests. Do not leave
// registration defaults behind for unrelated new-Quote scenarios.
test.afterEach(async ({ artisan }) => {
  const response = await artisan.api.post("/api/quotes", {
    maxRetries: 2,
    headers: { origin: artisan.baseURL },
    data: { action: "defaults-save", defaults: {} },
  });
  expect(response.ok()).toBe(true);
  expect((await artisan.api.post("/language", {
    maxRetries: 2,
    headers: { origin: artisan.baseURL },
    form: { locale: "en", returnTo: "/quotes" },
  })).ok()).toBe(true);
});

test("records load failure offers keyboard retry without enabling an empty defaults overwrite", async ({ artisan }) => {
  const { page } = artisan;
  await expect(page.getByRole("textbox", { name: "Search Quotes" })).toBeVisible();
  let failLoad = true;
  await page.route("**/api/quotes", async (route) => {
    if (route.request().method() === "GET" && failLoad) {
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Customers and defaults" }).press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Could not load records. Try again.");
  await expect(dialog.getByRole("button", { name: "Save defaults" })).toBeDisabled();
  failLoad = false;
  await dialog.getByRole("button", { name: "Retry", exact: true }).press("Enter");
  await expect(dialog.getByRole("button", { name: "Save defaults" })).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("defaults retain entries through a lost save response and announce success only after retry", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.setViewportSize({ width: 1280, height: 580 });
  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  const dialog = page.getByRole("dialog");
  const defaults = dialog.getByRole("region", { name: "Business defaults" });
  await defaults.getByLabel("Business name").fill("Atelier des Érables");
  await defaults.getByLabel("VAT registered").selectOption("no");
  await defaults.getByLabel("Default terms").fill("Acompte de 20 %. Solde à 30 jours.\nLivraison en octobre. Garantie de 2 ans.");
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let loseResponse = true;
  await page.route("**/api/quotes", async (route) => {
    if (route.request().method() !== "POST" || route.request().postDataJSON()?.action !== "defaults-save" || !loseResponse) return route.continue();
    loseResponse = false;
    const accepted = await route.fetch();
    expect(accepted.ok()).toBe(true);
    await responseGate;
    await route.fulfill({ status: 503, json: { error: "connection_failed" } });
  });
  await defaults.getByRole("button", { name: "Save defaults" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Saving…");
  await expect(defaults.getByRole("button", { name: "Save defaults" })).toBeDisabled();
  releaseResponse();
  await expect(dialog.getByRole("alert")).toContainText("Could not save the defaults. Your entries are kept. Try again.");
  await expect(defaults.getByLabel("Business name")).toHaveValue("Atelier des Érables");
  await dialog.getByRole("button", { name: "Retry", exact: true }).press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Defaults saved for new Quotes. This Quote is unchanged.");
  await expect(dialog.getByRole("status")).toBeInViewport({ ratio: 1 });
  await dialog.getByRole("button", { name: "Close" }).press("Enter");
  await page.reload();
  await expect(page.getByRole("article").getByRole("strong").filter({ hasText: /^Atelier du Bois Sàrl$/ })).toBeVisible();
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  await expect(defaults.getByLabel("Business name")).toHaveValue("Atelier des Érables");
  await expect(defaults.getByLabel("Default terms")).toHaveValue("Acompte de 20 %. Solde à 30 jours.\nLivraison en octobre. Garantie de 2 ans.");
});

test("new Quotes copy defaults without filling or refreshing existing drafts", async ({ artisan }) => {
  const { page, api, baseURL } = artisan;
  expect((await api.post("/api/quotes", { headers: { origin: baseURL }, data: { action: "defaults-save", defaults: {} } })).ok()).toBe(true);
  await page.getByRole("button", { name: "New Quote", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prepare a Quote" })).toBeAttached();
  const incompleteUrl = page.url();
  await expect(page.locator(".qp-business-name")).toHaveText("Entreprise à renseigner");
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  const defaults = page.getByRole("region", { name: "Business defaults" });
  await expect(defaults.getByText("To change this Quote's business details, select the business block in the Quote.")).toBeVisible();
  await defaults.getByLabel("Business name").fill("Atelier des Tilleuls");
  await defaults.getByLabel("Address", { exact: true }).fill("Rue Exemple 4\n1000 Exemple");
  await defaults.getByLabel("Contact details").fill("bonjour@example.test · 021 000 00 00");
  await defaults.getByLabel("VAT registered").selectOption("no");
  await defaults.getByLabel("Default terms").fill("Paiement à 30 jours. Livraison en octobre. Garantie de 2 ans.");
  await defaults.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("This Quote is unchanged.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.locator(".qp-business-name")).toHaveText("Entreprise à renseigner");
  await page.getByRole("button", { name: "My Quotes", exact: true }).click();
  await page.getByRole("button", { name: "New Quote", exact: true }).click();
  const paper = page.getByRole("article");
  await expect(paper).toContainText("Atelier des Tilleuls");
  await expect(paper).toContainText("Rue Exemple 4");
  await expect(paper).toContainText("bonjour@example.test · 021 000 00 00");
  await expect(paper).toContainText("Paiement à 30 jours. Livraison en octobre. Garantie de 2 ans.");
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  await defaults.getByLabel("Business name").fill("Atelier des Tilleuls actualisé");
  await defaults.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("This Quote is unchanged.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(paper).toContainText("Atelier des Tilleuls");
  await expect(paper).not.toContainText("Atelier des Tilleuls actualisé");
  await page.goto(incompleteUrl);
  await expect(page.locator(".qp-business-name")).toHaveText("Entreprise à renseigner");
});

test("quote-local business and VAT edits autosave and undo without changing defaults", async ({ artisan }) => {
  const { page, api, baseURL } = artisan;
  expect((await api.post("/api/quotes", { headers: { origin: baseURL }, data: {
    action: "defaults-save", defaults: { businessName: "Atelier des Tilleuls", vatRegistered: false },
  } })).ok()).toBe(true);
  const seeded = await createCompleteQuote(artisan);
  await page.goto(`/quotes?id=${seeded.id}`);
  const paper = page.getByRole("article");
  await paper.getByRole("button", { name: "Edit business details" }).press("Enter");
  const editor = page.getByRole("dialog", { name: "Business details for this Quote" });
  await expect(editor).toContainText("These details and VAT status change this Working Draft only.");
  await editor.getByLabel("Business name").fill("Atelier local au devis");
  await editor.getByLabel("VAT identifier").fill("");
  await expect(editor.getByLabel('VAT identifier')).toHaveAccessibleDescription('VAT identifier missing');
  await expect(editor.getByLabel('VAT identifier')).toHaveAttribute('aria-invalid', 'false');
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(paper).toContainText("Atelier local au devis");
  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  await expect(paper).toContainText("Atelier du Bois Sàrl");

  await paper.getByRole("button", { name: "Edit business details" }).click();
  await editor.getByLabel("Business name").fill("Atelier local au devis");
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await paper.getByRole("button", { name: "Edit terms" }).click();
  const terms = page.getByRole("dialog", { name: "Quote terms" });
  await terms.getByLabel("Terms", { exact: true }).fill("Acompte convenu de 15 %. Solde à 45 jours.");
  await terms.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  const defaults = page.getByRole("region", { name: "Business defaults" });
  await expect(defaults.getByLabel("Business name")).toHaveValue("Atelier des Tilleuls");
  await defaults.getByLabel("Business name").fill("Atelier des Tilleuls actualisé");
  await defaults.getByRole("button", { name: "Save defaults" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("This Quote is unchanged.");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(paper).toContainText("Atelier local au devis");
  await expect(paper).toContainText("Acompte convenu de 15 %. Solde à 45 jours.");
  await paper.getByRole("button", { name: "Edit business details" }).click();
  await editor.getByRole("button", { name: "Restore from business settings" }).click();
  await expect(editor.getByLabel("Business name")).toHaveValue("Atelier des Tilleuls actualisé");
  await editor.getByRole("button", { name: "Cancel" }).click();
  await paper.getByRole("button", { name: "Edit terms" }).click();
  await terms.getByRole("button", { name: "Restore default terms" }).click();
  await expect(terms.getByLabel("Terms", { exact: true })).toHaveValue("");
  await terms.getByRole("button", { name: "Cancel" }).click();
  await expect(paper).toContainText("Acompte convenu de 15 %. Solde à 45 jours.");
  await page.getByLabel("Interface language / Langue de l’interface").selectOption("fr");
  await expect(paper.getByRole("button", { name: "Modifier les coordonnées de l’entreprise" })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole("radio", { name: "Devis", exact: true }).click();
  await expect(paper).toContainText("Acompte convenu de 15 %. Solde à 45 jours.");
  await expect(paper.getByText("Total CHF", { exact: true })).toBeVisible();
});

test("saving a Customer does not discard pending defaults, and closing asks before discarding them", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  const dialog = page.getByRole("dialog");
  const defaults = dialog.getByRole("region", { name: "Business defaults" });
  await expect(defaults.getByLabel("Business name")).toBeEnabled();
  const originalName = await defaults.getByLabel("Business name").inputValue();
  await defaults.getByLabel("Business name").fill("Valeur non enregistrée");
  const customer = dialog.getByRole("region", { name: "Customer record" });
  await customer.getByLabel("Name", { exact: true }).fill("Maison du Saule");
  await customer.getByLabel("Address", { exact: true }).fill("Rue Exemple 7");
  await customer.getByRole("button", { name: "Create Customer" }).click();
  const savedCustomerOption = customer.getByLabel("Choose a Customer").getByRole("option", { name: /Maison du Saule/ });
  await expect(savedCustomerOption).toHaveCount(1);
  await expect(defaults.getByLabel("Business name")).toHaveValue("Valeur non enregistrée");
  await customer.getByLabel("Choose a Customer").selectOption(await savedCustomerOption.getAttribute("value") ?? "");
  await dialog.getByRole("button", { name: "Use for this Quote" }).press("Enter");
  const confirmation = page.getByRole("alertdialog", { name: "Discard unsaved default edits?", exact: true });
  await expect(confirmation.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmation).toHaveCount(0);
  await expect(defaults.getByLabel("Business name")).toHaveValue("Valeur non enregistrée");
  await page.keyboard.press("Escape");
  await confirmation.getByRole("button", { name: "Discard edits", exact: true }).press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Customers and defaults" }).press("Enter");
  await expect(defaults.getByLabel("Business name")).toHaveValue(originalName);
});

for (const locale of ["en", "fr"] as const) {
  test(`clearing only the Quote-local VAT identifier persists after reload in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    await page.getByLabel("Interface language / Langue de l’interface").selectOption(locale);
    await page.setViewportSize({ width: 800, height: 900 });
    await page.getByRole("radio", { name: locale === "en" ? "Quote" : "Devis", exact: true }).click();
    const details = page.getByRole("button", { name: locale === "en" ? "Edit business details" : "Modifier les coordonnées de l’entreprise" });
    await details.click();
    const editor = page.getByRole("dialog", { name: locale === "en" ? "Business details for this Quote" : "Votre entreprise sur ce devis" });
    const identifier = editor.getByLabel(locale === "en" ? "VAT identifier" : "Numéro TVA");
    await expect(identifier).toHaveValue("CHE-000.000.000 TVA");
    await identifier.fill("");
    await expect(identifier).toHaveValue("");
    await editor.getByRole("button", { name: locale === "en" ? "Apply" : "Appliquer", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(locale === "en" ? "Saved" : "Enregistré");
    await page.reload();
    await page.getByRole("radio", { name: locale === "en" ? "Quote" : "Devis", exact: true }).click();
    await details.click();
    await expect(identifier).toHaveValue("");
  });

  test(`registered business defaults require an identifier with keyboard validation in ${locale}`, async ({ artisan }) => {
    const { page, api, baseURL } = artisan;
    const reset = await api.post("/api/quotes", { headers: { origin: baseURL }, data: { action: "defaults-save", defaults: {} } });
    expect(reset.ok()).toBe(true);
    await page.getByLabel("Interface language / Langue de l’interface").selectOption(locale);
    const opener = page.getByRole("button", { name: locale === "en" ? "Customers and defaults" : "Clients et valeurs par défaut" });
    await opener.press("Enter");
    const dialog = page.getByRole("dialog");
    const defaults = dialog.getByRole("region", { name: locale === "en" ? "Business defaults" : "Valeurs par défaut de l'entreprise" });
    const registration = defaults.getByLabel(locale === "en" ? "VAT registered" : "Assujetti à la TVA");
    await expect(registration).toHaveValue("unknown");
    await registration.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    const identifier = defaults.getByLabel(locale === "en" ? "VAT identifier" : "Numéro TVA");
    await expect(identifier).toBeFocused();
    await identifier.fill("   ");
    const save = defaults.getByRole("button", { name: locale === "en" ? "Save defaults" : "Enregistrer les valeurs par défaut" });
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(identifier).toBeFocused();
    await expect(identifier).toHaveAttribute("aria-invalid", "true");
    await expect(identifier).toHaveAccessibleDescription(locale === "en"
      ? "Enter the VAT identifier for a registered business."
      : "Indiquez le numéro TVA de l'entreprise assujettie.");
    await expect(defaults.getByText(locale === "en" ? /current 8.1% standard rate/ : /taux normal actuel de 8,1 %/)).toBeVisible();
    await identifier.fill("CHE-000.000.000 TVA");
    await expect(identifier).toHaveAttribute("aria-invalid", "false");
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toContainText(locale === "en"
      ? "Defaults saved for new Quotes."
      : "Valeurs par défaut enregistrées pour les nouveaux devis.");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(identifier).toHaveValue("CHE-000.000.000 TVA");
    await expect(registration).toHaveValue("yes");
  });
}
