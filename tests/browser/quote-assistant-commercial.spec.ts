import { createCompleteQuote, expect, setInterfaceLanguage, test } from "./fixtures";

for (const locale of ["en", "fr"] as const) {
  const copy = locale === "fr"
    ? { message: "Votre message", send: "Envoyer le message", dialog: "Modifier le devis", view: "Voir les détails modifiés", titleChanged: "Objet modifié", discountChanged: "Remise modifiée", cancel: "Annuler" }
    : { message: "Your message", send: "Send message", dialog: "Edit quote", view: "View changed details", titleChanged: "Title changed", discountChanged: "Discount changed", cancel: "Cancel" };

  test(`commercial administrative and VAT/Discount corrections are visible in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const detail = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json();

    await page.goto(`/quotes?id=${seeded.id}`);
    await page.route("**/api/quotes", async (route) => {
      if (route.request().postDataJSON()?.action !== "assistant") return route.continue();
      const next = structuredClone(detail);
      next.version += 1;
      next.draft.title = "Projet corrigé";
      next.draft.customerName = "Maison corrigée";
      next.draft.customerAddress = "Rue corrigée 4\\n1000 Lausanne";
      next.draft.businessName = "Atelier corrigé Sàrl";
      next.draft.vatRegistered = false;
      next.draft.vatId = "";
      next.draft.discountMode = "percent";
      next.draft.discount = "5";
      next.messages.push({
        role: "assistant",
        fr: "Modifications administratives et fiscales enregistrées.",
        en: "Administrative and tax corrections saved.",
        changed: [],
        changedFields: ["customerName", "title", "businessName", "vatRegistered", "vatId", "discountMode", "discount"],
      });
      await route.fulfill({ json: next });
    });

    await page.getByLabel(copy.message).fill("Corrige les informations de ce Quote.");
    await page.getByRole("button", { name: copy.send, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveRole("dialog");
    await expect(page.getByRole("heading", { name: copy.dialog })).toBeVisible();
    await expect(page.locator("#manual-title")).toHaveValue("Projet corrigé");
    await expect(page.locator("#manual-customer-name")).toHaveValue("Maison corrigée");
    await expect(page.locator("#manual-business-name")).toHaveValue("Atelier corrigé Sàrl");
    await expect(page.locator("#manual-vat-registered")).toHaveValue("no");
    await expect(page.locator("#manual-vat-id")).toHaveValue("");
    await expect(page.locator("#manual-discount-mode")).toHaveValue("percent");
    await expect(page.locator("#manual-discount")).toHaveValue("5");

    await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(page.getByText(copy.titleChanged, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.discountChanged, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.view, exact: true })).toBeVisible();
  });
}
