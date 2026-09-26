import type { Page } from '@playwright/test';
import { createCompleteQuote, expect, requestQuote, setInterfaceLanguage, test } from './fixtures';

// #19: later Working Drafts, revision 2, and list reopening, in both interface languages.

for (const locale of ['en', 'fr'] as const) {
  const fr = locale === 'fr';
  const copy = {
    draftBadge: fr ? 'Brouillon' : 'Draft',
    revisionBadge: (number: number) => fr ? `Révision ${number}` : `Revision ${number}`,
    publishedBadge: (number: number) => fr ? `Révision publiée ${number}` : `Published revision ${number}`,
    workingDraft: fr ? 'Brouillon de travail' : 'Working draft',
    newRevision: fr ? 'Nouvelle révision' : 'New revision',
    resume: fr ? 'Reprendre' : 'Resume draft',
    version: fr ? 'Version du devis' : 'Quote version',
    editLine: fr ? 'Modifier la ligne 1' : 'Edit line 1',
    amount: fr ? 'Montant' : 'Amount',
    apply: fr ? 'Appliquer' : 'Apply',
    saved: fr ? 'Enregistré' : 'Saved',
    review: fr ? 'Relire et publier' : 'Review & publish',
    confirm: fr ? 'Confirmer la publication' : 'Confirm publication',
    close: fr ? 'Fermer' : 'Close',
  };

  test(`an Artisan prepares, reopens and publishes revision 2 while revision 1 stays unchanged in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    const published = await requestQuote(artisan, { action: 'publish', id: seeded.id, expectedVersion: seeded.version, requestId: crypto.randomUUID() });
    expect(published.ok).toBe(true);
    await setInterfaceLanguage(page, locale);

    const row = (target: Page) => target.locator('.qp-list-row').filter({ has: target.getByText(`Maison des Tilleuls SA · ${seeded.draft.reference}`, { exact: true }) });
    const openFromList = async (badge: string) => {
      await page.goto('/quotes');
      await expect(row(page)).toContainText(badge);
      await row(page).click();
      await expect(page).toHaveURL(new RegExp(`id=${seeded.id}`));
    };
    const expectReadOnly = async (number: number, total: string) => {
      await expect(page.getByText(copy.publishedBadge(number), { exact: true })).toBeVisible();
      await expect(page.getByText(total, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: copy.editLine })).toHaveCount(0);
    };

    // Without a Working Draft, the list opens the latest Published Revision read-only.
    await openFromList(copy.revisionBadge(1));
    await expectReadOnly(1, 'CHF 108.10');
    await page.getByRole('button', { name: copy.newRevision }).click();
    await expect(page.getByText(copy.workingDraft, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: copy.editLine }).click();
    await page.getByLabel(copy.amount).fill('200.00');
    await page.getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(copy.saved);

    // With a Working Draft, the list opens that draft; revision 1 is still inspectable and unchanged.
    await openFromList(copy.draftBadge);
    await expect(page.getByText(copy.workingDraft, { exact: true })).toBeVisible();
    await expect(page.getByText('CHF 216.20', { exact: true })).toBeVisible();
    await page.getByLabel(copy.version).selectOption({ label: copy.revisionBadge(1) });
    await expectReadOnly(1, 'CHF 108.10');
    await expect(page.getByRole('button', { name: copy.resume })).toBeVisible();
    await page.getByRole('button', { name: copy.resume }).click();
    await expect(page.getByText('CHF 216.20', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: copy.review }).click();
    await page.getByRole('button', { name: copy.confirm }).click();
    await page.getByRole('dialog').getByRole('button', { name: copy.close, exact: true }).click();
    await expectReadOnly(2, 'CHF 216.20');

    await openFromList(copy.revisionBadge(2));
    await expectReadOnly(2, 'CHF 216.20');
    await expect(page.getByLabel(copy.version).locator('option')).toHaveText([copy.revisionBadge(1), copy.revisionBadge(2)]);
    await page.getByLabel(copy.version).selectOption({ label: copy.revisionBadge(1) });
    await expectReadOnly(1, 'CHF 108.10');

    // Even from revision 1, a new Working Draft starts from the latest revision.
    await page.getByRole('button', { name: copy.newRevision }).click();
    await expect(page.getByText(copy.workingDraft, { exact: true })).toBeVisible();
    await expect(page.getByText('CHF 216.20', { exact: true })).toBeVisible();
  });
}
