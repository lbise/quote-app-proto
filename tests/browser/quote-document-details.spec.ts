import { createCompleteQuote, expect, test } from './fixtures';

test('the document edits quote details in place without changing defaults', async ({ artisan }) => {
  const quote = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.goto(`/quotes?id=${quote.id}`);
  await page.getByRole('button', { name: 'Edit Quote title' }).click();
  await page.getByRole('textbox', { name: 'Quote title' }).fill('Custom shelves');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Edit reference and dates' }).click();
  await page.getByLabel('Valid until').fill('2026-10-01');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Edit site address' }).click();
  await page.getByRole('button', { name: 'Copy Customer address' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Add discount' }).click();
  await page.getByLabel('Discount', { exact: true }).selectOption('percent');
  await page.getByLabel('Value', { exact: true }).fill('5');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Edit terms' }).click();
  await page.getByLabel('Terms', { exact: true }).fill('Payment after installation.');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.qp-paper')).toContainText('Custom shelves');
  await expect(page.locator('.qp-paper')).toContainText('Payment after installation.');
  await expect(page.locator('.qp-paper')).toContainText('5 %');
  await expect(page.locator('.qp-paper')).toContainText('2026-10-01');
});

test('restoring business settings previews changes but does not restore terms', async ({ artisan }) => {
  const quote = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.goto(`/quotes?id=${quote.id}`);
  await page.getByRole('button', { name: 'Customers and defaults' }).click();
  await page.getByLabel('Business name').fill('Default workshop');
  await page.getByLabel('Address', { exact: true }).last().fill('Workshop street 1');
  await page.getByLabel('Contact details').fill('info@workshop.example');
  await page.getByLabel('Default terms').fill('Default conditions');
  await page.getByRole('button', { name: 'Save defaults' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Edit business details' }).click();
  await page.getByRole('button', { name: 'Restore from business settings' }).click();
  await expect(page.getByLabel('Business name')).toHaveValue('Default workshop');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.qp-paper')).toContainText('Atelier du Bois Sàrl');
  await page.getByRole('button', { name: 'Edit business details' }).click();
  await page.getByRole('button', { name: 'Restore from business settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.locator('.qp-paper')).toContainText('Default workshop');
  await expect(page.locator('.qp-paper')).toContainText('Prix en CHF, TVA comprise.');
});

test('a new Customer is saved only on explicit opt-in', async ({ artisan }) => {
  const quote = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.goto(`/quotes?id=${quote.id}`);
  await page.getByRole('button', { name: 'Choose or edit Customer' }).click();
  await page.getByRole('button', { name: /New Customer \(clear fields\)/ }).click();
  await page.getByLabel('Customer name').fill('New Customer AB');
  await page.getByLabel('Customer address').fill('New street 2');
  await page.getByLabel('Save to customer list').check();
  await page.getByRole('button', { name: 'Apply to Quote' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Choose or edit Customer' }).click();
  await page.getByLabel('Search Customers').fill('New Customer AB');
  await expect(page.getByLabel('Saved Customer').getByRole('option', { name: /New Customer AB/ })).toHaveCount(1);
});
