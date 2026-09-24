import { createCompleteQuote, expect, test } from './fixtures';

test('an Artisan can correct a rejected duplicate reference without losing the Working Draft', async ({ artisan }) => {
  const first = await createCompleteQuote(artisan);
  const second = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.goto(`/quotes?id=${second.id}`);
  await page.getByRole('button', { name: 'Edit reference and dates' }).click();
  await page.locator('#metadata-reference').fill(first.draft.reference);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Not saved');

  await page.getByRole('button', { name: 'Edit reference and dates' }).click();
  await page.locator('#metadata-reference').fill(second.draft.reference);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit line 1', exact: true })).toBeVisible();
  await expect(page.getByText(second.draft.reference, { exact: true })).toBeVisible();
});
