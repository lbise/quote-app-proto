import type { Locator } from '@playwright/test';
import type { QuoteData } from '../../app/lib/quote';
import { createCompleteQuote, expect, setInterfaceLanguage, test } from './fixtures';

type Artisan = Parameters<typeof createCompleteQuote>[0];
async function seed(artisan: Artisan, patch: Partial<QuoteData>) {
  const record = await createCompleteQuote(artisan);
  const result = await artisan.page.evaluate(async ({ record, patch }) => {
    const response = await fetch('/api/quotes', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'save', id: record.id, expectedVersion: record.version, requestId: crypto.randomUUID(), quote: { ...record.draft, ...patch } }),
    });
    return { ok: response.ok, data: await response.json() };
  }, { record, patch });
  expect(result.ok).toBe(true);
  await artisan.page.goto(`/quotes?id=${record.id}`);
  return record;
}
async function missing(input: Locator, message: string) {
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(input).toHaveAccessibleDescription(new RegExp(message));
  await expect(input.locator('..')).toHaveAttribute('data-missing', 'true');
  const colors = await input.evaluate(element => ({ border: getComputedStyle(element).borderTopColor, warning: getComputedStyle(element.parentElement!.querySelector('.qp-field-message')!).color }));
  expect(colors.border).toBe(colors.warning);
}

for (const locale of ['en', 'fr'] as const) {
  const fr = locale === 'fr';
  const copy = {
    quantity: fr ? 'Quantité manquante' : 'Quantity missing', price: fr ? 'Prix manquant' : 'Price missing',
    address: fr ? 'Adresse du client manquante' : 'Customer address missing', vat: fr ? 'Statut TVA à préciser' : 'VAT status missing',
    apply: fr ? 'Appliquer' : 'Apply', cancel: fr ? 'Annuler' : 'Cancel', saved: fr ? 'Enregistré' : 'Saved',
  };
  test(`missing details are local, focusable and clear after correction in ${locale}`, async ({ artisan }, testInfo) => {
    const { page } = artisan;
    await seed(artisan, {
      customerAddress: '', customerContact: '', siteAddress: '', terms: '', validUntil: '', vatRegistered: null, vatId: '',
      lines: [
        { id: 'quantity-line', sectionId: '', description: 'Pose des panneaux', mode: 'quantity', quantity: '', unit: 'm²', unitPrice: '', amount: '' },
        { id: 'free-line', sectionId: '', description: 'Nettoyage offert', mode: 'fixed', quantity: '', unit: '', unitPrice: '', amount: '0' },
      ],
    });
    await setInterfaceLanguage(page, locale);
    const paper = page.getByRole('article');
    const line = page.getByTestId('quote-line').first();
    await expect(line.getByRole('button', { name: copy.quantity, exact: true })).toBeVisible();
    await expect(line.getByRole('button', { name: copy.price, exact: true })).toBeVisible();
    await expect(paper.locator('.qp-field-warning')).toHaveCount(4);
    await expect(page.getByTestId('quote-line').last().locator('.qp-field-warning')).toHaveCount(0);
    await expect(page.locator('.qp-editor-guidance')).toContainText(fr ? '1 ligne à compléter' : '1 line needs details');

    if (!fr) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: testInfo.outputPath('missing-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('radio', { name: 'Quote', exact: true }).click();
      await line.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('missing-mobile.png') });
    }
    const quantityWarning = line.getByRole('button', { name: copy.quantity, exact: true });
    await quantityWarning.focus();
    await quantityWarning.press('Enter');
    const quantity = page.locator('#line-quantity');
    await expect(quantity).toBeFocused();
    await missing(quantity, copy.quantity);
    await missing(page.locator('#line-unit-price'), copy.price);
    if (!fr) await page.screenshot({ path: testInfo.outputPath('missing-editor.png') });
    await quantity.fill('0');
    await expect(quantity).toHaveAttribute('aria-invalid', 'true');
    await expect(quantity.locator('..')).not.toHaveAttribute('data-missing');
    const invalidColors = await quantity.evaluate(element => ({ border: getComputedStyle(element).borderTopColor, error: getComputedStyle(element.parentElement!.querySelector('[data-slot="field-error"]')!).color }));
    expect(invalidColors.border).toBe(invalidColors.error);
    await expect(quantity).toHaveAccessibleDescription(fr ? 'La quantité doit être supérieure à zéro.' : 'Quantity must be greater than zero.');
    await page.getByRole('dialog').getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(quantity).toBeFocused();
    await quantity.fill('2');
    await expect(quantity.locator('..')).not.toHaveAttribute('data-missing');
    await expect(quantity).toHaveAttribute('aria-invalid', 'false');
    await page.getByRole('dialog').getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(line.getByRole('button', { name: copy.quantity, exact: true })).toHaveCount(0);
    await line.getByRole('button', { name: copy.price, exact: true }).click();
    await expect(page.locator('#line-unit-price')).toBeFocused();
    await page.locator('#line-unit-price').fill('-1');
    await expect(page.locator('#line-unit-price')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#line-unit-price')).toHaveAccessibleDescription(fr ? 'La valeur ne peut pas être négative.' : 'The value cannot be negative.');
    await page.locator('#line-unit-price').fill('0');
    await expect(page.locator('#line-unit-price')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#line-unit-price')).not.toHaveAttribute('aria-describedby');
    await page.getByRole('dialog').getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(line.locator('.qp-field-warning')).toHaveCount(0);
    await expect(page.locator('.qp-editor-guidance')).toContainText(fr ? 'Informations à compléter' : 'Details need completing');

    await paper.getByRole('button', { name: copy.address, exact: true }).click();
    const address = page.getByRole('textbox', { name: fr ? 'Adresse du client' : 'Customer address', exact: true });
    await expect(address).toBeFocused();
    await missing(address, copy.address);
    await address.fill('Rue Exemple 4');
    await expect(address.locator('..')).not.toHaveAttribute('data-missing');
    await page.getByRole('dialog').getByRole('button', { name: fr ? 'Appliquer au devis' : 'Apply to Quote' }).click();
    await expect(paper.getByRole('button', { name: copy.address, exact: true })).toHaveCount(0);
    await paper.getByRole('button', { name: copy.vat, exact: true }).click();
    await expect(page.locator('#business-vatRegistered')).toBeFocused();
    await missing(page.locator('#business-vatRegistered'), copy.vat);
    await page.locator('#business-vatRegistered').selectOption('no');
    await expect(page.locator('#business-vatId').locator('..')).not.toHaveAttribute('data-missing');
    await page.getByRole('dialog').getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(page.locator('.qp-editor-guidance')).toHaveCount(0);
    await expect(paper.locator('.qp-field-warning')).toHaveCount(0);
    await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
    await page.reload();
    await expect(paper.locator('.qp-field-warning')).toHaveCount(0);
  });
}

test('banner opens a missing description even when a fixed price is supplied; publication links use the same target', async ({ artisan }) => {
  const { page } = artisan;
  await seed(artisan, { lines: [{ id: 'described-later', sectionId: '', description: ' ', mode: 'fixed', quantity: '', unit: '', unitPrice: '', amount: '150' }] });
  await page.locator('.qp-editor-guidance').getByRole('button', { name: 'View' }).click();
  await expect(page.locator('#line-description')).toBeFocused();
  await missing(page.locator('#line-description'), 'Description missing');
  await expect(page.locator('#line-amount').locator('..')).not.toHaveAttribute('data-missing');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Review & publish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fix', exact: true }).click();
  await expect(page.locator('#line-description')).toBeFocused();
  await page.locator('#line-description').fill('Pose');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.qp-editor-guidance')).toHaveCount(0);
  await expect(page.getByTestId('quote-line')).toContainText('150.00');
});

test('every required detail navigates from the banner and warns in its editor', async ({ artisan }) => {
  const { page } = artisan;
  await seed(artisan, { reference: '', title: '', issueDate: '', customerName: '', businessName: '', businessAddress: '', businessContact: '', vatId: '', discountMode: 'fixed', discount: '' });
  const cases = [
    ['Reference missing', '#metadata-reference', 'DEV-FOCUS', 'Apply'],
    ['Title missing', '#quote-title-input', 'Focus fixture', 'Save'],
    ['Customer name missing', 'input[id$="-name"]', 'Maison Exemple', 'Apply to Quote'],
    ['Business name missing', '#business-businessName', 'Atelier Exemple', 'Apply'],
    ['Business address missing', '#business-businessAddress', 'Rue Exemple 1', 'Apply'],
    ['Business contact details missing', '#business-businessContact', 'bonjour@example.test', 'Apply'],
    ['Issue date missing', '#metadata-issueDate', '2026-09-01', 'Apply'],
    ['VAT identifier missing', '#business-vatId', 'CHE-000.000.000 TVA', 'Apply'],
    ['Discount missing', '#quote-discount-edit', '0', 'Apply'],
  ];
  for (const [message, selector, value, action] of cases) {
    await expect(page.getByRole('article').getByRole('button', { name: message, exact: true })).toBeVisible();
    await page.locator('.qp-editor-guidance').getByRole('button', { name: 'View' }).click();
    const input = page.locator(selector);
    await expect(input).toBeFocused();
    await missing(input, message);
    await input.fill(value);
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('article').getByRole('button', { name: message, exact: true })).toHaveCount(0);
  }
  await expect(page.locator('.qp-editor-guidance')).toHaveCount(0);
});

test('a missing section name uses the same warning and banner navigation', async ({ artisan }) => {
  const { page } = artisan;
  await seed(artisan, { sections: [{ id: 'unnamed-section', title: '' }] });
  await expect(page.getByRole('button', { name: 'Section name missing', exact: true })).toBeVisible();
  await page.locator('.qp-editor-guidance').getByRole('button', { name: 'View' }).click();
  await expect(page.locator('#section-rename-0')).toBeFocused();
  await missing(page.locator('#section-rename-0'), 'Section name missing');
  await page.locator('#section-rename-0').fill('Pose');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Section name missing', exact: true })).toHaveCount(0);
  await expect(page.locator('.qp-editor-guidance')).toHaveCount(0);
});

test('unit and fixed price warnings focus their inputs, and an empty Quote banner starts a line', async ({ artisan }) => {
  const { page } = artisan;
  await seed(artisan, { lines: [] });
  await page.locator('.qp-editor-guidance').getByRole('button', { name: 'View' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a line' })).toBeVisible();
  await page.locator('#line-description').fill('Pose');
  await page.locator('#line-quantity').fill('1');
  await page.locator('#line-unit').fill('');
  await page.locator('#line-unit-price').fill('0');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Unit missing', exact: true }).click();
  await expect(page.locator('#line-unit')).toBeFocused();
  await missing(page.locator('#line-unit'), 'Unit missing');
  await page.locator('#line-mode').selectOption('fixed');
  await missing(page.locator('#line-amount'), 'Price missing');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Price missing', exact: true }).click();
  await expect(page.locator('#line-amount')).toBeFocused();
  await page.locator('#line-amount').fill('0');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.qp-editor-guidance')).toHaveCount(0);
});
