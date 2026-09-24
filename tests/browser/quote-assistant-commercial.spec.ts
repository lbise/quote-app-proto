import { createCompleteQuote, expect, setInterfaceLanguage, test } from "./fixtures";

for (const locale of ["en", "fr"] as const) {
  const copy = locale === "fr"
    ? { message: "Votre message", send: "Envoyer le message", customer: "Choisir ou modifier le client", customerDialog: "Client du devis", customerName: "Nom du client", business: "Modifier les coordonnées de l’entreprise", businessDialog: "Votre entreprise sur ce devis", businessName: "Raison sociale", vat: "Assujetti à la TVA", vatId: "Numéro TVA", title: "Modifier l’objet du devis", titleInput: "Objet du devis", discount: "Modifier la remise", discountDialog: "Remise du devis", titleChanged: "Objet modifié", discountChanged: "Remise modifiée", view: "Voir les détails modifiés", cancel: "Annuler" }
    : { message: "Your message", send: "Send message", customer: "Choose or edit Customer", customerDialog: "Quote Customer", customerName: "Customer name", business: "Edit business details", businessDialog: "Business details for this Quote", businessName: "Business name", vat: "VAT registered", vatId: "VAT identifier", title: "Edit Quote title", titleInput: "Quote title", discount: "Edit discount", discountDialog: "Quote discount", titleChanged: "Title changed", discountChanged: "Discount changed", view: "View changed details", cancel: "Cancel" };

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

    const customer = page.getByRole("dialog", { name: copy.customerDialog });
    await expect(customer.getByLabel(copy.customerName)).toHaveValue("Maison corrigée");
    await expect(customer.getByLabel(locale === "fr" ? "Adresse du client" : "Customer address")).toHaveValue("Rue corrigée 4\\n1000 Lausanne");
    await customer.getByRole("button", { name: copy.cancel, exact: true }).click();

    const paper = page.getByRole("article");
    await paper.getByRole("button", { name: copy.title }).click();
    await expect(page.getByLabel(copy.titleInput)).toHaveValue("Projet corrigé");
    await page.getByRole("button", { name: copy.cancel, exact: true }).click();
    await paper.getByRole("button", { name: copy.business }).click();
    const business = page.getByRole("dialog", { name: copy.businessDialog });
    await expect(business.getByLabel(copy.businessName)).toHaveValue("Atelier corrigé Sàrl");
    await expect(business.getByLabel(copy.vat)).toHaveValue("no");
    await expect(business.getByLabel(copy.vatId)).toHaveValue("");
    await business.getByRole("button", { name: copy.cancel, exact: true }).click();
    await paper.getByRole("button", { name: copy.discount }).click();
    const discount = page.getByRole("dialog", { name: copy.discountDialog });
    await expect(discount.locator("#quote-discount-mode")).toHaveValue("percent");
    await expect(discount.locator("#quote-discount-edit")).toHaveValue("5");
    await discount.getByRole("button", { name: copy.cancel, exact: true }).click();

    await expect(page.getByText(copy.titleChanged, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.discountChanged, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.view, exact: true }).click();
    await expect(page.getByRole("dialog", { name: copy.customerDialog }).getByLabel(copy.customerName)).toHaveValue("Maison corrigée");
  });
}
