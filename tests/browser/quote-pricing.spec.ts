import type { Page } from '@playwright/test';
import type { QuoteData, QuoteLine } from '../../app/lib/quote';
import { createCompleteQuote, expect, requestQuote, setInterfaceLanguage, test } from './fixtures';

// #15: whole-Quote Discount and VAT review in the Working Draft, in both interface languages.

type Artisan = Parameters<typeof createCompleteQuote>[0];

const syntheticLines: QuoteLine[] = [
  { id: 'cutting', sectionId: '', description: 'Découpe', mode: 'quantity', quantity: '0.125', unit: 'h', unitPrice: '80.20', amount: '' },
  { id: 'supply', sectionId: '', description: 'Fourniture', mode: 'quantity', quantity: '2', unit: 'pce', unitPrice: '45.50', amount: '' },
  { id: 'fixed', sectionId: '', description: 'Forfait', mode: 'fixed', quantity: '', unit: '', unitPrice: '', amount: '25.00' },
];

async function seed(artisan: Artisan, patch: Partial<QuoteData>) {
  const record = await createCompleteQuote(artisan);
  const saved = await requestQuote(artisan, { action: 'save', id: record.id, expectedVersion: record.version, requestId: crypto.randomUUID(), quote: { ...record.draft, ...patch } });
  expect(saved.ok).toBe(true);
  await artisan.page.goto(`/quotes?id=${record.id}`);
  return record;
}

function totalsOf(page: Page) {
  const totals = page.locator('#quote-totals');
  return {
    totals,
    row: (label: string) => totals.locator(':scope > div').filter({ has: page.getByText(label, { exact: true }) }),
  };
}

for (const locale of ['en', 'fr'] as const) {
  const fr = locale === 'fr';
  const copy = {
    addDiscount: fr ? 'Ajouter une remise' : 'Add discount',
    editDiscount: fr ? 'Modifier la remise' : 'Edit discount',
    discountDialog: fr ? 'Remise du devis' : 'Quote discount',
    discount: fr ? 'Remise' : 'Discount',
    value: fr ? 'Valeur' : 'Value',
    percentage: fr ? 'Pourcentage' : 'Percentage',
    fixedAmount: fr ? 'Montant fixe' : 'Fixed amount',
    apply: fr ? 'Appliquer' : 'Apply',
    saved: fr ? 'Enregistré' : 'Saved',
    undo: fr ? 'Annuler la dernière modification' : 'Undo last change',
    editBusiness: fr ? 'Modifier les coordonnées de l’entreprise' : 'Edit business details',
    businessDialog: fr ? 'Votre entreprise sur ce devis' : 'Business details for this Quote',
    vatRegistered: fr ? 'Assujetti à la TVA' : 'VAT registered',
    no: fr ? 'Non' : 'No',
    partial: fr ? 'Chiffrage partiel' : 'Partially priced',
  };

  test(`discount and VAT editing reconciles, persists and undoes in ${locale}`, async ({ artisan }) => {
    const { page } = artisan;
    await seed(artisan, { lines: syntheticLines });
    await setInterfaceLanguage(page, locale);
    const { totals, row } = totalsOf(page);

    await expect(row('Sous-total HT')).toContainText('126.03');
    await expect(row('TVA 8,1 %')).toContainText('10.21');
    await expect(row('Total CHF')).toContainText('136.24');
    await expect(totals.getByText(/^Remise/)).toHaveCount(0);

    await totals.getByRole('button', { name: copy.addDiscount }).click();
    const dialog = page.getByRole('dialog', { name: copy.discountDialog });
    await dialog.getByLabel(copy.discount, { exact: true }).selectOption({ label: copy.percentage });
    await dialog.getByLabel(copy.value, { exact: true }).fill('10.555');
    await dialog.getByRole('button', { name: copy.apply, exact: true }).click();
    // Excess precision is rejected in place instead of being rounded.
    await expect(dialog.getByLabel(copy.value, { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel(copy.value, { exact: true })).toBeFocused();
    await dialog.getByLabel(copy.value, { exact: true }).fill('10');
    await dialog.getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText(copy.saved);

    const discounted = async () => {
      await expect(row('Sous-total HT')).toContainText('126.03');
      await expect(row('Remise 10 %')).toContainText('− 12.60');
      await expect(row('Sous-total après remise HT')).toContainText('113.43');
      await expect(row('TVA 8,1 %')).toContainText('9.19');
      await expect(row('Total CHF')).toContainText('122.62');
    };
    await discounted();
    await page.reload();
    await discounted();

    await page.getByRole('button', { name: copy.undo, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(copy.saved);
    await expect(totals.getByText(/^Remise/)).toHaveCount(0);
    await expect(row('Total CHF')).toContainText('136.24');
    await page.reload();
    await expect(row('Total CHF')).toContainText('136.24');

    // Not VAT registered: no VAT row at all, rather than a 0% row.
    await page.getByRole('article').getByRole('button', { name: copy.editBusiness }).click();
    const business = page.getByRole('dialog', { name: copy.businessDialog });
    await business.getByLabel(copy.vatRegistered, { exact: true }).selectOption({ label: copy.no });
    await business.getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(copy.saved);
    await expect(totals.getByText(/^TVA/)).toHaveCount(0);
    await expect(row('Total CHF')).toContainText('126.03');

    // A fixed discount equal to the subtotal is a valid zero total.
    await totals.getByRole('button', { name: copy.addDiscount }).click();
    await dialog.getByLabel(copy.discount, { exact: true }).selectOption({ label: copy.fixedAmount });
    await dialog.getByLabel(copy.value, { exact: true }).fill('126.03');
    await dialog.getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(copy.saved);
    const zero = async () => {
      await expect(row('Remise CHF')).toContainText('− 126.03');
      await expect(row('Total CHF')).toContainText('0.00');
      await expect(totals.getByText(/^TVA/)).toHaveCount(0);
      await expect(totals.getByText('Sous-total après remise HT')).toHaveCount(0);
    };
    await zero();
    await page.reload();
    await zero();
  });

  test(`incomplete pricing keeps known amounts and withholds the total in ${locale}`, async ({ artisan }) => {
    const { page } = artisan;
    await seed(artisan, {
      discountMode: 'percent', discount: '10',
      lines: [...syntheticLines, { id: 'unpriced', sectionId: '', description: 'Pose à chiffrer', mode: 'fixed', quantity: '', unit: '', unitPrice: '', amount: '' }],
    });
    await setInterfaceLanguage(page, locale);
    const { row } = totalsOf(page);

    await expect(row('Sous-total partiel HT')).toContainText('126.03');
    await expect(row('Remise 10 %')).toContainText('—');
    await expect(row('Sous-total après remise HT')).toContainText('—');
    await expect(row('TVA 8,1 %')).toContainText('—');
    await expect(row('Total à compléter')).toContainText('—');
    await expect(page.locator('.qp-document-bottom')).toContainText(copy.partial);
    await expect(page.locator('.qp-document-bottom')).toContainText('126.03');
  });
}
