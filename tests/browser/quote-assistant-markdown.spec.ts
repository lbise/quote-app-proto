import { createCompleteQuote, expect, setInterfaceLanguage, test } from './fixtures';

for (const locale of ['en', 'fr'] as const) {
  test(`assistant chat renders Markdown without formatting Artisan text in ${locale}`, async ({ artisan }) => {
    const seeded = await createCompleteQuote(artisan);
    const { page } = artisan;
    if (locale === 'fr') { await page.setViewportSize({ width: 390, height: 844 }); await setInterfaceLanguage(page, 'fr'); }
    const detail = await (await page.request.get(`/api/quotes?id=${seeded.id}`)).json();
    await page.goto(`/quotes?id=${seeded.id}`);
    await expect(page.getByRole('heading', { name: locale === 'fr' ? 'Assistant IA' : 'AI assistant' })).toBeVisible();
    await expect(page.getByText('Contenu commercial en français, quelle que soit la langue de l’interface.')).toHaveCount(0);
    await expect(page.getByText('Commercial content stays in French, independently of the interface language.')).toHaveCount(0);

    await page.route('**/api/quotes', async route => {
      if (route.request().postDataJSON()?.action !== 'assistant') return route.continue();
      const next = structuredClone(detail);
      next.version++;
      next.messages.push({ role: 'artisan', fr: '**keep my raw text**', en: '**keep my raw text**' });
      next.messages.push({ role: 'assistant', fr: '## Résumé\n\n- **Premier** point\n- Deuxième point\n\n[Voir](https://example.com)\n\n```sh\necho oui\n```\n\n| Élément | Prix |\n| --- | --- |\n| Bois | 20 |', en: '## Summary\n\n- **First** point\n- Second point\n\n[Read](https://example.com)\n\n```sh\necho yes\n```\n\n| Item | Price |\n| --- | --- |\n| Wood | 20 |'  });
      await route.fulfill({ json: next });
    });

    await page.getByLabel(locale === 'fr' ? 'Votre message' : 'Your message').fill('**keep my raw text**');
    await page.getByRole('button', { name: locale === 'fr' ? 'Envoyer le message' : 'Send message' }).click();
    const markdown = page.locator('.qp-message-markdown');
    await expect(markdown.getByRole('heading', { name: locale === 'fr' ? 'Résumé' : 'Summary' })).toBeVisible();
    await expect(markdown.locator('li')).toHaveCount(2);
    await expect(markdown.locator('strong')).toHaveText(locale === 'fr' ? 'Premier' : 'First');
    await expect(markdown.getByRole('link', { name: locale === 'fr' ? 'Voir' : 'Read' })).toHaveAttribute('href', 'https://example.com');
    await expect(markdown.locator('pre code')).toContainText(locale === 'fr' ? 'echo oui' : 'echo yes');
    await expect(markdown.locator('table tbody tr')).toHaveCount(1);
    await expect(page.getByText('**keep my raw text**', { exact: true })).toBeVisible();
  });
}
