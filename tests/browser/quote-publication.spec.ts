import type { QuoteData } from '../../app/lib/quote';
import { createCompleteQuote, expect, requestQuote, setInterfaceLanguage, test } from './fixtures';

// #18: reviewing and confirming Publication of Published Revision 1, in both interface languages.

for (const locale of ['en', 'fr'] as const) {
  const fr = locale === 'fr';
  const copy = {
    review: fr ? 'Relire et publier' : 'Review & publish',
    reviewDialog: fr ? 'Relire avant publication' : 'Review before publication',
    notSent: fr ? 'La publication fige le contenu. Elle n’envoie pas le devis.' : 'Publication freezes the content. It does not send the Quote.',
    revision: fr ? 'Révision 1' : 'Revision 1',
    back: fr ? 'Retour au devis' : 'Back to Quote',
    confirm: fr ? 'Confirmer la publication' : 'Confirm publication',
    publishedDialog: fr ? 'Révision 1 publiée' : 'Revision 1 published',
    close: fr ? 'Fermer' : 'Close',
    workingDraft: fr ? 'Brouillon de travail' : 'Working draft',
    publishedBadge: fr ? 'Révision publiée 1' : 'Published revision 1',
    frozen: fr ? 'Révision figée. Publication sans envoi au destinataire.' : 'Frozen revision. Publication did not send this Quote.',
    newRevision: fr ? 'Nouvelle révision' : 'New revision',
    undo: fr ? 'Annuler la dernière modification' : 'Undo last change',
    editLine: fr ? 'Modifier la ligne 1' : 'Edit line 1',
    amount: fr ? 'Montant' : 'Amount',
    apply: fr ? 'Appliquer' : 'Apply',
    saved: fr ? 'Enregistré' : 'Saved',
    notSaved: fr ? 'Non enregistré' : 'Not saved',
    retry: fr ? 'Réessayer' : 'Retry',
    unavailable: fr ? 'Publication indisponible' : 'Publication unavailable',
    customerAddress: fr ? 'Adresse du client, à compléter' : 'Customer address, required',
    vatRegistration: fr ? 'Assujettissement à la TVA, à compléter' : 'VAT registration, required',
    fix: fr ? 'Corriger' : 'Fix',
    unsavedReason: fr ? 'Les modifications ne sont pas enregistrées. Réessayez l’enregistrement avant de publier.' : 'Changes are not saved. Retry saving before publishing.',
    assistantReason: fr ? 'Une modification de l’assistant est en cours. Attendez sa fin avant de publier.' : 'An assistant change is in progress. Wait for it to finish before publishing.',
    message: fr ? 'Votre message' : 'Your message',
    send: fr ? 'Envoyer le message' : 'Send message',
  };

  test(`an Artisan reviews, confirms and reopens a read-only Published Revision 1 in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    await setInterfaceLanguage(page, locale);

    // A latest change exists, so Undo is available before Publication.
    await page.getByRole('button', { name: copy.editLine }).click();
    await page.getByLabel(copy.amount).fill('150.00');
    await page.getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(copy.saved);
    await expect(page.getByRole('button', { name: copy.undo, exact: true })).toBeEnabled();

    await page.getByRole('button', { name: copy.review }).click();
    const review = page.getByRole('dialog', { name: copy.reviewDialog });
    await expect(review).toContainText(copy.notSent);
    await expect(review).toContainText('Bibliothèque sur mesure');
    await expect(review).toContainText('Maison des Tilleuls SA');
    await expect(review).toContainText('CHF 162.15');
    await expect(review).toContainText(`${seeded.draft.reference} · ${copy.revision}`);
    await review.getByRole('button', { name: copy.back }).click();
    await expect(review).toHaveCount(0);
    await expect(page.getByText(copy.workingDraft, { exact: true })).toBeVisible();
    const unpublished = await (await artisan.api.get(`/api/quotes?id=${seeded.id}`)).json();
    expect(unpublished.revisions).toEqual([]);

    await page.getByRole('button', { name: copy.review }).click();
    await review.getByRole('button', { name: copy.confirm }).click();
    const published = page.getByRole('dialog', { name: copy.publishedDialog });
    await expect(published).toBeVisible();
    await published.getByRole('button', { name: copy.close, exact: true }).click();

    const readOnly = async () => {
      await expect(page.getByText(copy.publishedBadge, { exact: true })).toBeVisible();
      await expect(page.getByText(copy.frozen)).toBeVisible();
      await expect(page.getByText('CHF 162.15', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: copy.editLine })).toHaveCount(0);
      await expect(page.getByRole('button', { name: copy.undo, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: copy.review })).toHaveCount(0);
    };
    await readOnly();
    await page.reload();
    await readOnly();

    // A later Working Draft starts without an Undo target: Publication is not undoable.
    await page.getByRole('button', { name: copy.newRevision }).click();
    await expect(page.getByText(copy.workingDraft, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: copy.undo, exact: true })).toBeDisabled();
  });

  test(`Publication is blocked with explicit reasons for incomplete content in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    const incomplete: Partial<QuoteData> = { customerAddress: '', vatRegistered: null, vatId: '' };
    const saved = await requestQuote(artisan, { action: 'save', id: seeded.id, expectedVersion: seeded.version, requestId: crypto.randomUUID(), quote: { ...seeded.draft, ...incomplete } });
    expect(saved.ok).toBe(true);
    await page.goto(`/quotes?id=${seeded.id}`);
    await setInterfaceLanguage(page, locale);

    await page.getByRole('button', { name: copy.review }).click();
    const review = page.getByRole('dialog', { name: copy.reviewDialog });
    const blocked = review.getByRole('alert');
    await expect(blocked).toContainText(copy.unavailable);
    await expect(blocked).toContainText(copy.customerAddress);
    await expect(blocked).toContainText(copy.vatRegistration);
    await expect(review.getByRole('button', { name: copy.confirm })).toBeDisabled();
    await blocked.getByRole('listitem').filter({ hasText: copy.customerAddress }).getByRole('button', { name: copy.fix }).click();
    await expect(review).toHaveCount(0);
    const detail = await requestQuote(artisan, { action: 'publish', id: seeded.id, expectedVersion: (saved.data as { version: number }).version, requestId: crypto.randomUUID() });
    expect(detail.status).toBe(422);
  });

  test(`Publication explains an unsaved change and a pending assistant change in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    await page.goto(`/quotes?id=${seeded.id}`);
    await setInterfaceLanguage(page, locale);
    let failSave = true;
    let assistantStarted!: () => void;
    let releaseAssistant!: () => void;
    const assistantRequest = new Promise<void>((resolve) => { assistantStarted = resolve; });
    const assistantResponse = new Promise<void>((resolve) => { releaseAssistant = resolve; });
    await page.route('**/api/quotes**', async (route) => {
      const payload = route.request().postDataJSON() as { action?: string } | null;
      if (failSave && payload?.action === 'save') {
        failSave = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'connection_failed' }) });
        return;
      }
      if (payload?.action === 'assistant') {
        assistantStarted();
        await assistantResponse;
        await route.abort().catch(() => undefined);
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: copy.editLine }).click();
    await page.getByLabel(copy.amount).fill('150.00');
    await page.getByRole('button', { name: copy.apply, exact: true }).click();
    await expect(page.getByRole('status')).toContainText(copy.notSaved);
    await page.getByRole('button', { name: copy.review }).click();
    const review = page.getByRole('dialog', { name: copy.reviewDialog });
    await expect(review.getByRole('alert')).toContainText(copy.unsavedReason);
    await expect(review.getByRole('button', { name: copy.confirm })).toBeDisabled();
    await review.getByRole('button', { name: copy.back }).click();
    await page.getByRole('button', { name: copy.retry }).click();
    await expect(page.getByRole('status')).toHaveText(copy.saved);

    await page.getByLabel(copy.message).fill('Change the title.');
    await page.getByRole('button', { name: copy.send }).click();
    await assistantRequest;
    await page.getByRole('button', { name: copy.review }).click();
    await expect(review.getByRole('alert')).toContainText(copy.assistantReason);
    await expect(review.getByRole('alert')).not.toContainText(copy.unsavedReason);
    await expect(review.getByRole('button', { name: copy.confirm })).toBeDisabled();
    await review.getByRole('button', { name: copy.back }).click();
    releaseAssistant();
    const unpublished = await (await artisan.api.get(`/api/quotes?id=${seeded.id}`)).json();
    expect(unpublished.revisions).toEqual([]);
  });
}
