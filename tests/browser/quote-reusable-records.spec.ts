import { createCompleteQuote, expect, setInterfaceLanguage, test } from "./fixtures";

test("using a Customer record copies it into the Working Draft without later record updates rewriting it", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  await expect(page.getByRole("heading", { name: "Customers and defaults" })).toBeVisible();

  const customerRecord = page.getByRole("region", { name: "Customer record" });
  await customerRecord.getByRole("textbox", { name: "Name", exact: true }).fill("Camille Réutilisable");
  await customerRecord.getByRole("textbox", { name: "Address", exact: true }).fill("Rue du Lac 10\n1000 Lausanne");
  await page.getByRole("button", { name: "Create Customer" }).click();
  await expect(page.getByText("Customer created. This Quote is unchanged.")).toBeVisible();
  await expect(page.locator(".qp-paper").getByText("Rue du Lac 10")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("article").getByRole("button", { name: "Choose or edit Customer" }).click();
  const quoteCustomer = page.getByRole("dialog", { name: "Quote Customer" });
  const saved = quoteCustomer.getByLabel("Saved Customer");
  await saved.selectOption(await saved.getByRole("option", { name: /Camille Réutilisable/ }).getAttribute("value") ?? "");
  await expect(quoteCustomer.getByLabel("Customer address")).toHaveValue("Rue du Lac 10\n1000 Lausanne");
  await quoteCustomer.getByRole("button", { name: "Apply to Quote" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByText("Rue du Lac 10")).toBeVisible();

  await page.getByRole("button", { name: "Customers and defaults" }).click();
  const selectedOption = page.getByLabel("Choose a Customer").getByRole("option", { name: /Camille Réutilisable/ });
  await page.getByLabel("Choose a Customer").selectOption(await selectedOption.getAttribute("value") ?? "");
  await page.getByRole("region", { name: "Customer record" }).getByRole("textbox", { name: "Address", exact: true }).fill("Rue du Lac 12\n1000 Lausanne");
  await page.getByRole("button", { name: "Update Customer" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(page.getByText("Rue du Lac 10")).toBeVisible();
  await expect(page.getByText("Rue du Lac 12")).toHaveCount(0);
});

test('retrying Customer creation after a lost response creates only one reusable record', async ({ artisan }) => {
  const { page } = artisan;
  await page.getByRole('button', { name: 'New Quote', exact: true }).click();
  await page.getByRole('article').getByRole('button', { name: 'Choose or edit Customer' }).click();
  const editor = page.getByRole('dialog', { name: 'Quote Customer' });
  let loseResponse = true;
  await page.route('**/api/quotes', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.action !== 'customer-save' || !loseResponse) return route.continue();
    loseResponse = false;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({ status: 503, json: { error: 'connection_failed' } });
  });
  await editor.getByRole('checkbox', { name: 'Save to customer list' }).check();
  await editor.getByRole('button', { name: 'Apply to Quote' }).click();
  await expect(editor.getByLabel('Customer name')).toHaveAttribute('aria-invalid', 'false');
  await expect(editor.getByLabel('Customer name')).toHaveAccessibleDescription('Customer name missing');
  await expect(editor.getByLabel('Customer address')).toHaveAttribute('aria-invalid', 'false');
  await expect(editor.getByLabel('Customer address')).toHaveAccessibleDescription('Customer address missing');
  await expect(editor.getByLabel('Customer name')).toBeFocused();
  await editor.getByLabel('Customer name').fill('Customer retry fixture');
  await expect(editor.getByLabel('Customer name')).toHaveAttribute('aria-invalid', 'false');
  await editor.getByLabel('Customer address').fill('Rue Exemple 1');
  await editor.getByRole('button', { name: 'Apply to Quote' }).click();
  await expect(editor.getByRole('alert')).toContainText('Customer not saved');
  await expect(editor.getByLabel('Customer name')).toHaveValue('Customer retry fixture');
  await editor.getByRole('button', { name: 'Apply to Quote' }).click();
  await expect(page.getByRole('article')).toContainText('Customer retry fixture');
  await page.getByRole('article').getByRole('button', { name: 'Choose or edit Customer' }).click();
  await expect(editor.getByLabel('Saved Customer').getByRole('option', { name: /Customer retry fixture/ })).toHaveCount(1);
});

for (const locale of ["en", "fr"] as const) {
  test(`Customer search, saved selection and replacement stay explicit in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);
    const copy = locale === "en"
      ? { opener: "Customers and defaults", heading: "Customers and defaults", name: "Name", address: "Address", create: "Create Customer", customer: "Choose or edit Customer", dialog: "Quote Customer", search: "Search Customers", saved: "Saved Customer", localAddress: "Customer address", apply: "Apply to Quote", newCustomer: "New Customer (clear fields)", noMatch: "No Customers match your search." }
      : { opener: "Clients et valeurs par défaut", heading: "Clients et valeurs par défaut", name: "Nom", address: "Adresse", create: "Créer le client", customer: "Choisir ou modifier le client", dialog: "Client du devis", search: "Rechercher un client", saved: "Client enregistré", localAddress: "Adresse du client", apply: "Appliquer au devis", newCustomer: "Nouveau client (effacer les champs)", noMatch: "Aucun client ne correspond à la recherche." };
    await page.getByRole("button", { name: copy.opener }).click();
    await expect(page.getByRole("heading", { name: copy.heading })).toBeVisible();
    const customerRecord = page.getByRole("region", { name: locale === "en" ? "Customer record" : "Fiche client" });
    const uniqueName = locale === "en" ? "École de l'Orme" : "Maison de l'Érable";
    await customerRecord.getByRole("textbox", { name: copy.name, exact: true }).fill(uniqueName);
    await customerRecord.getByRole("textbox", { name: copy.address, exact: true }).fill("Rue des Tilleuls 22\n1000 Lausanne");
    await page.getByRole("button", { name: copy.create }).click();
    await expect(page.getByText(locale === "en" ? "Customer created. This Quote is unchanged." : "Client créé. Ce devis est inchangé.")).toBeVisible();
    await expect(page.locator(".qp-paper")).toContainText("Maison des Tilleuls SA");
    await page.getByRole("button", { name: locale === "en" ? "Close" : "Fermer", exact: true }).click();

    await page.getByRole("article").getByRole("button", { name: copy.customer }).click();
    const editor = page.getByRole("dialog", { name: copy.dialog });
    await editor.getByLabel(copy.search).fill("zzzz-no-match");
    await expect(editor.getByText(copy.noMatch)).toBeVisible();
    await editor.getByLabel(copy.search).fill(locale === "en" ? "ecole" : "erable");
    const selector = editor.getByLabel(copy.saved);
    const option = selector.getByRole("option", { name: new RegExp(uniqueName) });
    await expect(option).toHaveCount(1);
    await selector.selectOption(await option.getAttribute("value") ?? "");
    await expect(editor.getByLabel(copy.localAddress)).toHaveValue("Rue des Tilleuls 22\n1000 Lausanne");
    await editor.getByLabel(copy.localAddress).fill("Rue locale 99");
    await editor.getByRole("button", { name: copy.apply }).click();
    await expect(page.locator(".qp-paper")).toContainText("Rue locale 99");
    await page.getByRole("article").getByRole("button", { name: copy.customer }).click();
    await expect(editor.getByLabel(copy.localAddress)).toHaveValue("Rue locale 99");
    await editor.getByRole("button", { name: copy.newCustomer }).click();
    await expect(editor.getByLabel(copy.localAddress)).toHaveValue("");
    await expect(editor.getByLabel(copy.saved)).toHaveValue("");
    await editor.getByRole("button", { name: locale === "en" ? "Cancel" : "Annuler" }).click();
    await expect(page.locator(".qp-paper")).toContainText("Rue locale 99");
  });
}
