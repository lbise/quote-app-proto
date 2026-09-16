import { createCompleteQuote, expect, setInterfaceLanguage, test } from './fixtures';

test('assistant changes to the title, discount and sections are visible beside the Quote', async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  const detail = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json();
  await page.goto(`/quotes?id=${seeded.id}`);
  await page.route('**/api/quotes', async route => {
    if (route.request().postDataJSON()?.action !== 'assistant') return route.continue();
    const next = structuredClone(detail);
    next.version++;
    next.draft.title = 'Bibliothèque du salon';
    next.draft.discountMode = 'percent';
    next.draft.discount = '3';
    next.draft.sections = [{ id: 'salon', title: 'Salon' }];
    next.draft.lines[0].sectionId = 'salon';
    next.messages.push({ role: 'assistant', fr: 'Modifications appliquées.', en: 'Changes applied.', changed: [], changedFields: ['title', 'discount', 'section:salon'] });
    await route.fulfill({ json: next });
  });
  await page.getByLabel('Your message').fill('Use the title Bibliothèque du salon, a Salon section and a 3% discount.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Title changed', { exact: true })).toBeVisible();
  await expect(page.getByText('Section changed', { exact: true })).toBeVisible();
  await expect(page.getByText('Discount changed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View changed details' })).toBeVisible();
});

for (const locale of ["en", "fr"] as const) {
  test(`automatic reveal keeps the composer focus and explicit navigation focuses the changed line in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    if (locale === "fr") await setInterfaceLanguage(page, locale);
    const detail = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json();
    await page.goto(`/quotes?id=${seeded.id}`);
    await page.route("**/api/quotes", async (route) => {
      if (route.request().postDataJSON()?.action !== "assistant") return route.continue();
      const next = structuredClone(detail);
      next.version++;
      next.draft.lines[0].amount = "125.00";
      next.messages.push({ role: "assistant", fr: "Ligne modifiée.", en: "Line changed.", changed: [next.draft.lines[0].id] });
      await route.fulfill({ json: next });
    });
    const composer = page.getByLabel(locale === "fr" ? "Votre message" : "Your message");
    await composer.fill(locale === "fr" ? "Corrige le montant à 125." : "Change the amount to 125.");
    await composer.press("Enter");
    await expect(composer).toBeFocused();
    await page.getByRole("button", { name: locale === "fr" ? "Voir dans le devis" : "View in Quote" }).click();
    await expect(page.getByRole("button", { name: locale === "fr" ? "Modifier la ligne 1" : "Edit line 1" })).toBeFocused();
  });
}
