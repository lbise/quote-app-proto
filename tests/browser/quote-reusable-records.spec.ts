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
  await page.getByRole("button", { name: "Use for this Quote" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Replace Customer details in this Quote?");
  await page.getByRole("button", { name: "Replace in this Quote" }).click();
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
  await page.goto('/quotes');
  await page.getByRole('button', { name: 'Customers and defaults' }).click();
  let loseResponse = true;
  await page.route('**/api/quotes', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.action !== 'customer-save' || !loseResponse) return route.continue();
    loseResponse = false;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({ status: 503, json: { error: 'connection_failed' } });
  });
  const record = page.getByRole('region', { name: 'Customer record' });
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await expect(record.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(record.getByLabel('Address', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(record.getByLabel('Name', { exact: true })).toBeFocused();
  await record.getByRole('textbox', { name: 'Name', exact: true }).fill('Customer retry fixture');
  await expect(record.getByLabel('Name', { exact: true })).toHaveAttribute('aria-invalid', 'false');
  await record.getByRole('textbox', { name: 'Address', exact: true }).fill('Rue Exemple 1');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await expect(page.getByRole('dialog').getByRole('alert').first()).toContainText('Could not save the Customer');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await expect(page.getByLabel('Choose a Customer').getByRole('option', { name: /Customer retry fixture/ })).toHaveCount(1);
});

for (const locale of ["en", "fr"] as const) {
  test(`Customer search, saved selection and replacement stay explicit in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);
    const copy = locale === "en"
      ? { opener: "Customers and defaults", heading: "Customers and defaults", details: "Details & terms", apply: "Apply", name: "Name", address: "Address", create: "Create Customer", search: "Search Customers", choose: "Choose a Customer", use: "Use for this Quote", replace: "Replace in this Quote", keep: "Keep current Customer", discard: "Discard edits", noMatch: "No Customers match your search." }
      : { opener: "Clients et valeurs par défaut", heading: "Clients et valeurs par défaut", details: "Coordonnées et conditions", apply: "Appliquer", name: "Nom", address: "Adresse", create: "Créer le client", search: "Rechercher un client", choose: "Choisir un client", use: "Utiliser pour ce devis", replace: "Remplacer dans ce devis", keep: "Conserver le client actuel", discard: "Abandonner les modifications", noMatch: "Aucun client ne correspond à votre recherche." };
    await page.getByRole("button", { name: copy.opener }).click();
    await expect(page.getByRole("heading", { name: copy.heading })).toBeVisible();
    const customerRecord = page.getByRole("region", { name: locale === "en" ? "Customer record" : "Fiche client" });
    const uniqueName = locale === "en" ? "École de l'Orme" : "Maison de l'Érable";
    await customerRecord.getByRole("textbox", { name: copy.name, exact: true }).fill(uniqueName);
    await customerRecord.getByRole("textbox", { name: copy.address, exact: true }).fill("Rue des Tilleuls 22\n1000 Lausanne");
    await page.getByRole("button", { name: copy.create }).click();
    await expect(page.getByRole("button", { name: copy.use })).toBeEnabled();
    await expect(page.getByText(locale === "en" ? "Customer created. This Quote is unchanged." : "Client créé. Ce devis est inchangé.")).toBeVisible();
    await expect(page.locator(".qp-paper")).toContainText("Maison des Tilleuls SA");

    await customerRecord.getByRole("textbox", { name: copy.search, exact: true }).fill("zzzz-no-match");
    await expect(page.getByText(copy.noMatch)).toBeVisible();
    await customerRecord.getByRole("textbox", { name: copy.search, exact: true }).fill(locale === "en" ? "ecole" : "erable");
    const selector = page.getByLabel(copy.choose);
    await expect(selector.getByRole("option", { name: new RegExp(uniqueName) })).toHaveCount(1);
    await customerRecord.getByRole("textbox", { name: copy.search, exact: true }).press("Tab");
    await selector.press("ArrowDown");
    await selector.press("Enter");
    await expect(customerRecord.getByRole("textbox", { name: copy.address, exact: true })).toHaveValue("Rue des Tilleuls 22\n1000 Lausanne");
    await customerRecord.getByRole("textbox", { name: copy.address, exact: true }).fill("Rue locale 99");
    await expect(page.getByText(locale === "en" ? "Save or discard record edits before using this Customer." : "Enregistrez ou abandonnez les modifications de la fiche avant d'utiliser ce client.")).toBeVisible();
    await expect(page.getByRole("button", { name: copy.use })).toBeDisabled();
    await page.getByRole("button", { name: copy.discard }).click();
    await page.getByRole("button", { name: copy.use }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: copy.keep }).click();
    await expect(page.getByRole("button", { name: copy.use })).toBeFocused();
    await page.getByRole("button", { name: copy.use }).click();
    await page.getByRole("button", { name: copy.replace }).click();
    await expect(page.locator(".qp-paper")).toContainText("Rue des Tilleuls 22");

    await page.getByRole("button", { name: copy.details }).click();
    const details = page.getByRole("dialog");
    await details.locator("#manual-customer-address").fill("Rue locale 99");
    await details.getByRole("button", { name: copy.apply, exact: true }).click();
    await expect(page.locator(".qp-paper")).toContainText("Rue locale 99");
  });
}
