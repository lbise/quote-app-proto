import { createCompleteQuote, expect, test } from './fixtures';

test.use({ fictionalAssistantDisclosure: true });

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
  await page.getByRole('button', { name: 'Continue and send', exact: true }).click();
  await expect(page.getByText('Title changed', { exact: true })).toBeVisible();
  await expect(page.getByText('Section changed', { exact: true })).toBeVisible();
  await expect(page.getByText('Discount changed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View changed details' })).toBeVisible();
});
