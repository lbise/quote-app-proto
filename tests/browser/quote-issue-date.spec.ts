import { createCompleteQuote, expect, setInterfaceLanguage, test } from './fixtures';

// Today must follow the browser's date, not UTC, including near midnight.
test.use({ timezoneId: 'Europe/Zurich' });

for (const locale of ['fr', 'en'] as const) {
  test(`issue date Today helper stays local until Apply in ${locale}`, async ({ artisan }) => {
    const { page } = artisan;
    const seeded = await createCompleteQuote(artisan);
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);
    await page.clock.setFixedTime(new Date('2026-02-03T23:30:00Z'));
    const fr = locale === 'fr';
    const trigger = page.getByRole('button', { name: fr ? 'Modifier la référence et les dates' : 'Edit reference and dates', exact: true });
    const today = page.getByRole('button', { name: fr ? 'Aujourd’hui' : 'Today', exact: true });
    const issueDate = page.locator('#metadata-issueDate');
    const validity = page.locator('#metadata-validUntil');
    await trigger.click();
    await expect(today).toHaveAttribute('data-variant', 'outline');
    await expect(today).toHaveAttribute('data-size', 'sm');
    const dateBox = (await issueDate.boundingBox())!;
    const todayBox = (await today.boundingBox())!;
    expect(todayBox.y).toBeGreaterThanOrEqual(dateBox.y + dateBox.height);
    const original = await issueDate.inputValue();
    const originalValidity = await validity.inputValue();
    await issueDate.fill('');
    await expect(issueDate).toHaveAccessibleDescription(fr ? 'Date d’émission manquante' : 'Issue date missing');
    await today.focus();
    await today.press('Enter');
    await expect(issueDate).toHaveValue('2026-02-04');
    await expect(issueDate).not.toHaveAttribute('aria-describedby');
    await expect(validity).toHaveValue(originalValidity);
    await page.getByRole('button', { name: fr ? 'Annuler' : 'Cancel', exact: true }).click();
    await trigger.click();
    await expect(issueDate).toHaveValue(original);
    await today.click();
    const saved = page.waitForResponse(response => response.url().includes('/api/quotes') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
    await page.getByRole('button', { name: fr ? 'Appliquer' : 'Apply', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await trigger.click();
    await expect(issueDate).toHaveValue('2026-02-04');
    await expect(validity).toHaveValue(originalValidity);
  });
}
