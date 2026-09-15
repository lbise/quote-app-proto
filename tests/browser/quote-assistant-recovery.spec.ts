import { createCompleteQuote, expect, setInterfaceLanguage, test } from "./fixtures";

test.use({ fictionalAssistantDisclosure: true });

for (const locale of ["en", "fr"] as const) {
  const labels = locale === "fr"
    ? { message: "Votre message", send: "Envoyer le message", continue: "Continuer et envoyer", processing: "Je prépare la modification. Vous pouvez continuer à éditer.", edit: "Modifier la ligne 1", amount: "Montant", apply: "Appliquer", saved: "Enregistré", stale: "Votre correction est conservée" }
    : { message: "Your message", send: "Send message", continue: "Continue and send", processing: "Preparing the change. You can keep editing.", edit: "Edit line 1", amount: "Amount", apply: "Apply", saved: "Saved", stale: "Your edit is preserved" };

  test(`a delayed assistant response becomes stale when the Artisan keeps editing in the ${locale} interface`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    let assistantStarted!: () => void;
    let releaseAssistant!: () => void;
    const assistantRequest = new Promise<void>((resolve) => { assistantStarted = resolve; });
    const assistantResponse = new Promise<void>((resolve) => { releaseAssistant = resolve; });

    await page.goto(`/quotes?id=${seeded.id}`);
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    await page.route("**/api/quotes**", async (route) => {
      const payload = route.request().postDataJSON() as { action?: string } | null;
      if (payload?.action !== "assistant") return route.continue();
      assistantStarted();
      await assistantResponse;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(seeded) });
    });

    await page.getByLabel(labels.message).fill("Change the title.");
    await page.getByRole("button", { name: labels.send }).click();
    await page.getByRole("button", { name: labels.continue }).click();
    await assistantRequest;
    await expect(page.getByText(labels.processing)).toBeVisible();

    await page.getByRole("button", { name: labels.edit }).click();
    await page.getByLabel(labels.amount).fill("125.00");
    await page.getByRole("button", { name: labels.apply }).click();
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible();

    releaseAssistant();
    await expect(page.getByRole("alert")).toContainText(labels.stale);
    await expect(page.getByText("CHF 135.13", { exact: true })).toBeVisible();
  });
}
