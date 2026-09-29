import type { Page } from "@playwright/test";
import { createCompleteQuote, createEmptyQuote, expect, requestQuote, setInterfaceLanguage, test } from "./fixtures";

// #44: archive, restore and permanently delete Quotes.

type Detail = { id: string; version: number; draft: { reference: string } | null };

async function publishWithPendingDraft(artisan: Parameters<typeof createCompleteQuote>[0]) {
  const seeded = await createCompleteQuote(artisan);
  const published = await requestQuote(artisan, { action: "publish", id: seeded.id, expectedVersion: seeded.version, requestId: crypto.randomUUID() });
  const draft = await requestQuote(artisan, { action: "new-draft", id: seeded.id, expectedVersion: (published.data as Detail).version, requestId: crypto.randomUUID() });
  const pending = draft.data as Detail & { draft: Record<string, unknown> };
  const saved = await requestQuote(artisan, { action: "save", id: seeded.id, expectedVersion: pending.version, requestId: crypto.randomUUID(), quote: { ...pending.draft, title: "Bibliothèque agrandie" } });
  expect(saved.ok).toBe(true);
  return seeded;
}

const row = (page: Page, reference: string) => page.locator(".qp-list-row").filter({ has: page.getByText(new RegExp(`· ${reference}$`)) });

test("an Artisan archives, restores and deletes Quotes from the list", async ({ artisan }) => {
  const { page } = artisan;
  const draft = await createEmptyQuote(artisan);
  const published = await publishWithPendingDraft(artisan);
  const draftReference = draft.draft.reference;
  const publishedReference = published.draft.reference;
  await page.goto("/quotes");

  await expect(page.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
  await expect(row(page, draftReference)).toBeVisible();
  await row(page, draftReference).getByRole("button", { name: `Actions for Quote ${draftReference} New Quote` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Quote ${draftReference} archived.` })).toBeAttached();
  await expect(row(page, draftReference)).toHaveCount(0);

  // Search only covers the tab shown.
  await page.getByLabel("Search Quotes").fill(draftReference);
  await expect(page.getByText("No Quote matches this search.")).toBeVisible();
  await page.getByRole("tab", { name: "Archived" }).click();
  await expect(page.getByLabel("Search Quotes")).toHaveValue(draftReference);
  await expect(row(page, draftReference)).toBeVisible();
  await expect(row(page, publishedReference)).toHaveCount(0);
  await page.getByLabel("Search Quotes").fill("");

  await row(page, draftReference).getByRole("button", { name: /^Actions for Quote/ }).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expect(row(page, draftReference)).toHaveCount(0);
  await page.getByRole("tab", { name: "Active" }).click();
  await expect(row(page, draftReference)).toBeVisible();

  // Deleting a published Quote asks first, with Cancel focused.
  await row(page, publishedReference).getByRole("button", { name: /^Actions for Quote/ }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete this Quote permanently?" });
  await expect(dialog).toContainText("This cannot be undone.");
  await expect(dialog).toContainText(publishedReference);
  await expect(dialog).toContainText("Bibliothèque agrandie");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(row(page, publishedReference)).toBeVisible();

  await row(page, publishedReference).getByRole("button", { name: /^Actions for Quote/ }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, publishedReference)).toHaveCount(0);
  await page.reload();
  await expect(row(page, draftReference)).toBeVisible();
  await expect(row(page, publishedReference)).toHaveCount(0);
});

test("an Archived published Quote opens read-only and restores with its unpublished changes", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await publishWithPendingDraft(artisan);
  await page.goto(`/quotes?id=${seeded.id}`);
  await expect(page.getByText("Working draft", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Actions for Quote ${seeded.draft.reference} Bibliothèque agrandie` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  const banner = page.locator(".qp-archived-banner");
  await expect(banner).toContainText("Archived Quote");
  await expect(banner).toContainText("Unpublished changes are kept");
  await expect(page.getByText("Published revision 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bibliothèque sur mesure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit line 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review & publish" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume draft" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your message" })).toHaveCount(0);
  await expect(page.getByText("This Quote is archived. Restore it to continue.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();

  await page.reload();
  await expect(banner).toContainText("Archived Quote");
  await expect(page.getByText("Published revision 1")).toBeVisible();

  await banner.getByRole("button", { name: "Restore" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText("Working draft", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit line 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Quote title" })).toContainText("Bibliothèque agrandie");
});

test("an Archived Working Draft opens read-only in French and can be deleted from its page", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  const archived = await requestQuote(artisan, { action: "archive", id: seeded.id, requestId: crypto.randomUUID() });
  expect(archived.ok).toBe(true);
  await setInterfaceLanguage(page, "fr");
  await page.goto(`/quotes?id=${seeded.id}`);

  await expect(page.locator(".qp-archived-banner")).toContainText("Devis archivé");
  await expect(page.locator(".qp-archived-banner")).not.toContainText("modifications non publiées");
  await expect(page.getByText("Brouillon en lecture seule")).toBeVisible();
  await expect(page.getByText("Bibliothèque en chêne avec fixations invisibles.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier la ligne 1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aperçu PDF" })).toBeEnabled();

  await page.getByRole("button", { name: /^Actions du devis/ }).click();
  await expect(page.getByRole("menuitem", { name: "Restaurer" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Supprimer…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Supprimer ce devis définitivement ?" });
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeFocused();
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page).toHaveURL(/\/quotes$/);
  await expect(page.getByRole("heading", { name: "Mes devis" })).toBeVisible();
  await page.getByRole("tab", { name: "Archivés" }).click();
  await expect(row(page, seeded.draft.reference)).toHaveCount(0);
});
