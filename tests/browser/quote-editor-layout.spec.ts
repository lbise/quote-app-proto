import type { Locator, Page } from '@playwright/test';
import { createConversationQuote, expect, setInterfaceLanguage, test } from './fixtures';

const copy = {
  en: { edit: 'Edit line 2', title: 'Edit quote line 2', add: 'Add line to Séjour', newTitle: 'Add a line', quantity: 'Quantity', apply: 'Apply', cancel: 'Cancel', positive: 'Quantity must be greater than zero.', quote: 'Quote' },
  fr: { edit: 'Modifier la ligne 2', title: 'Modifier la ligne 2', add: 'Ajouter une ligne à Séjour', newTitle: 'Ajouter une ligne', quantity: 'Quantité', apply: 'Appliquer', cancel: 'Annuler', positive: 'La quantité doit être supérieure à zéro.', quote: 'Devis' },
};

async function showDocument(page: Page, locale: keyof typeof copy) {
  await page.getByRole('button', { name: copy[locale].edit, exact: true, includeHidden: true }).waitFor({ state: 'attached' });
  const tab = page.getByRole('radio', { name: copy[locale].quote, exact: true });
  if (await tab.isVisible()) await tab.click();
}

async function expectActionsVisible(dialog: Locator, applyName: string, cancelName: string) {
  for (const name of [cancelName, applyName]) {
    const button = dialog.getByRole('button', { name, exact: true });
    // Do not scroll the button into view: this must pass before any interaction.
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect.poll(() => button.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const modal = element.closest('[role="dialog"]')!.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.top >= Math.max(0, modal.top) && rect.bottom <= Math.min(innerHeight, modal.bottom)
        && rect.left >= 0 && rect.right <= innerWidth && Boolean(hit && element.contains(hit));
    })).toBe(true);
  }
}

const viewports = [
  { name: 'laptop', width: 1280, height: 720, touch: false, locale: 'en' },
  { name: 'phone', width: 390, height: 844, touch: true, locale: 'fr' },
  { name: 'short laptop', width: 1280, height: 400, touch: false, locale: 'fr' },
  { name: 'short phone', width: 390, height: 480, touch: true, locale: 'en' },
] as const;

for (const viewport of viewports) {
  test(`line editor keeps actions visible before and after validation on ${viewport.name}`, async ({ artisan, browser }) => {
    // All writes use the isolated browser database and a fresh fixture Quote.
    const quote = await createConversationQuote(artisan);
    const context = await browser.newContext({
      storageState: await artisan.page.context().storageState(),
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.touch,
      hasTouch: viewport.touch,
    });
    try {
      const page = await context.newPage();
      const text = copy[viewport.locale];
      await page.goto(`/quotes?id=${quote.id}`);
      await setInterfaceLanguage(page, viewport.locale);
      await showDocument(page, viewport.locale);
      const edit = page.getByRole('button', { name: text.edit, exact: true });
      await edit.click();
      const dialog = page.getByRole('dialog', { name: text.title, exact: true });
      await expect(dialog.getByRole('heading', { name: text.title, exact: true })).toBeVisible();
      const description = dialog.getByLabel('Description', { exact: true });
      if (viewport.touch) {
        // A non-editable label receives focus so opening does not request a keyboard.
        await expect(dialog.locator('label[for="line-description"]')).toBeFocused();
        await page.keyboard.press('Tab');
      }
      await expect(description).toBeFocused();
      await expectActionsVisible(dialog, text.apply, text.cancel);

      const quantity = dialog.getByLabel(text.quantity, { exact: true });
      await quantity.fill('0');
      await expectActionsVisible(dialog, text.apply, text.cancel);
      await dialog.getByRole('button', { name: text.apply, exact: true }).click();
      await expect(quantity).toBeFocused();
      await expect(quantity).toHaveAttribute('aria-invalid', 'true');
      await expect(quantity).toHaveAccessibleDescription(text.positive);
      await expect(quantity).toBeInViewport({ ratio: 1 });
      await expectActionsVisible(dialog, text.apply, text.cancel);

      await quantity.fill('9');
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/quotes'
        && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
      await dialog.getByRole('button', { name: text.apply, exact: true }).click();
      expect((await saved).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      await expect(edit).toBeFocused();

      await page.reload();
      await showDocument(page, viewport.locale);
      await edit.click();
      await expect(quantity).toHaveValue('9');
      await expect(dialog.getByLabel('Section', { exact: true })).toHaveValue('section-bedroom');
      await description.fill('Abandoned change');
      await dialog.getByRole('button', { name: text.cancel, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(edit).toBeFocused();
      await edit.click();
      await expect(description).toHaveValue('Habillage mural en chêne');
      await quantity.fill('99');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(edit).toBeFocused();
      await edit.click();
      await expect(quantity).toHaveValue('9');
      await page.keyboard.press('Escape');

      const add = page.getByRole('button', { name: text.add, exact: true });
      await add.click();
      const newLine = page.getByRole('dialog', { name: text.newTitle, exact: true });
      await expect(newLine.getByRole('heading', { name: text.newTitle, exact: true })).toBeVisible();
      await expectActionsVisible(newLine, text.apply, text.cancel);
      await newLine.getByRole('button', { name: text.cancel, exact: true }).click();
      await expect(add).toBeFocused();
      await expect(page.getByTestId('quote-line')).toHaveCount(3);
    } finally {
      await context.close();
    }
  });
}

test('detail editors retain visible actions with long content and validation on a short phone', async ({ artisan }) => {
  const quote = await createConversationQuote(artisan);
  const { page } = artisan;
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto(`/quotes?id=${quote.id}`);
  await showDocument(page, 'en');

  for (const editor of [
    { trigger: 'Edit business details', title: 'Business details for this Quote', field: 'Address' },
    { trigger: 'Edit site address', title: 'Site address', field: 'Site address' },
    { trigger: 'Edit terms', title: 'Quote terms', field: 'Terms' },
  ]) {
    await page.getByRole('button', { name: editor.trigger, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: editor.title, exact: true });
    await expectActionsVisible(dialog, 'Apply', 'Cancel');
    await dialog.getByLabel(editor.field, { exact: true }).fill('Long fixture content\n'.repeat(30));
    await expectActionsVisible(dialog, 'Apply', 'Cancel');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await page.getByRole('button', { name: 'Add discount', exact: true }).click();
  const discount = page.getByRole('dialog', { name: 'Quote discount', exact: true });
  await discount.getByLabel('Discount', { exact: true }).selectOption('percent');
  await discount.getByLabel('Value', { exact: true }).fill('101');
  await expectActionsVisible(discount, 'Apply', 'Cancel');
  await discount.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(discount.getByLabel('Value', { exact: true })).toBeFocused();
  await expect(discount.getByLabel('Value', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expectActionsVisible(discount, 'Apply', 'Cancel');
  await discount.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'Choose or edit Customer', exact: true }).click();
  const customer = page.getByRole('dialog', { name: 'Quote Customer', exact: true });
  await expectActionsVisible(customer, 'Apply to Quote', 'Cancel');
  await customer.getByRole('button', { name: 'New Customer (clear fields)', exact: true }).click();
  await customer.getByLabel('Save to customer list', { exact: true }).check();
  await customer.getByRole('button', { name: 'Apply to Quote', exact: true }).click();
  await expect(customer.getByLabel('Customer name', { exact: true })).toBeFocused();
  await expect(customer.getByLabel('Customer name', { exact: true })).toHaveAttribute('aria-invalid', 'false');
  await expect(customer.getByLabel('Customer name', { exact: true })).toHaveAccessibleDescription('Customer name missing');
  await expectActionsVisible(customer, 'Apply to Quote', 'Cancel');
  await customer.getByRole('button', { name: 'Cancel', exact: true }).click();
});
