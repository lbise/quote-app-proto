import { createCompleteQuote, expect, test } from './fixtures';

test('a Published Revision displays its stored calculation rather than recalculating it', async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const publishedResponse = await artisan.page.request.post('/api/quotes', {
    data: { action: 'publish', id: seeded.id, expectedVersion: seeded.version, requestId: crypto.randomUUID() },
    headers: { origin: artisan.baseURL },
  });
  expect(publishedResponse.ok()).toBe(true);
  const published = await publishedResponse.json();
  // A historical calculation is the read-only display contract, even if a newer
  // calculator would produce different cents for the same commercial inputs.
  published.revisions[0].calculation.lines[0].amount = 10005;
  published.revisions[0].calculation.subtotal = 10005;
  published.revisions[0].calculation.net = 10005;
  published.revisions[0].calculation.vat = 810;
  published.revisions[0].calculation.total = 10815;
  await artisan.page.route(`**/api/quotes?id=${seeded.id}`, route => route.fulfill({ json: published }));
  await artisan.page.goto(`/quotes?id=${seeded.id}`);
  await expect(artisan.page.getByText('Published revision 1', { exact: true })).toBeVisible();
  await expect(artisan.page.getByText('CHF 108.15', { exact: true })).toBeVisible();
  await expect(artisan.page.getByText('100.05', { exact: true }).first()).toBeVisible();
});
