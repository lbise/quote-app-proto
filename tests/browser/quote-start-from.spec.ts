import type { Page } from "@playwright/test";
import { createCompleteQuote, createEmptyQuote, expect, requestQuote, setInterfaceLanguage, test } from "./fixtures";

// #48: start a new Quote from one chosen version of an existing Quote.

type Detail = { id: string; version: number; draft: { reference: string } | null };

/** Revision 1 titled "Bibliothèque sur mesure", with a Working Draft titled "Bibliothèque agrandie" on top. */
async function publishWithPendingDraft(artisan: Parameters<typeof createCompleteQuote>[0]) {
  const seeded = await createCompleteQuote(artisan);
  const published = await requestQuote(artisan, { action: "publish", id: seeded.id, expectedVersion: seeded.version, requestId: crypto.randomUUID() });
  const draft = await requestQuote(artisan, { action: "new-draft", id: seeded.id, expectedVersion: (published.data as Detail).version, requestId: crypto.randomUUID() });
  const pending = draft.data as Detail & { draft: Record<string, unknown> & { lines: Record<string, unknown>[] } };
  const saved = await requestQuote(artisan, { action: "save", id: seeded.id, expectedVersion: pending.version, requestId: crypto.randomUUID(), quote: {
    ...pending.draft, title: "Bibliothèque agrandie",
    lines: [...pending.draft.lines, { id: "extra-line", sectionId: "", description: "Étagère supplémentaire", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "60.00" }],
  } });
  expect(saved.ok).toBe(true);
  return seeded;
}

const row = (page: Page, reference: string) => page.locator(".qp-list-row").filter({ has: page.getByText(new RegExp(`· ${reference}$`)) });

/** The new Quote's workspace, opened with the notice. Returns its reference. */
async function expectStartedQuote(page: Page, notice: string, sourceId: string) {
  await expect(page.getByRole("status").filter({ hasText: notice })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("id")).not.toBe(sourceId);
  await expect(page.getByText("Working draft", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose or edit Customer" })).not.toContainText("Maison des Tilleuls");
  await expect(page.getByRole("button", { name: "Edit site address" })).toContainText("Add site address");
  await expect(page.getByText("You", { exact: true })).toHaveCount(0);
}

test("an Artisan starts a new Quote from the version on screen in the workspace", async ({ artisan }) => {
  const { page } = artisan;
  const source = await publishWithPendingDraft(artisan);
  const reference = source.draft.reference;
  await page.goto(`/quotes?id=${source.id}`);
  await expect(page.getByText("Working draft", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "More Quote actions" }).click();
  await page.getByRole("menuitem", { name: "New Quote from the Working Draft" }).click();
  await expectStartedQuote(page, `Started from ${reference}, Working Draft`, source.id);
  await expect(page.getByRole("button", { name: "Edit Quote title" })).toContainText("Bibliothèque agrandie");
  await expect(page.getByTestId("quote-line")).toHaveCount(2);
  await expect(page.getByText("Étagère supplémentaire")).toBeVisible();
  await expect(page.locator(".qp-project-heading")).not.toContainText(reference);

  await page.getByRole("button", { name: "More Quote actions" }).click();
  await expect(page.getByRole("menuitem", { name: "New Quote from the Working Draft" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Started from" })).toHaveCount(0);

  // Back on the source, the menu names the revision selected on screen.
  await page.goto(`/quotes?id=${source.id}`);
  await page.getByLabel("Quote version").selectOption({ label: "Revision 1" });
  await expect(page.getByText("Published revision 1")).toBeVisible();
  await page.getByRole("button", { name: "More Quote actions" }).click();
  await expect(page.getByRole("menuitem", { name: "New Quote from the Working Draft" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "New Quote from Revision 1" }).click();
  await expectStartedQuote(page, `Started from ${reference}, Revision 1`, source.id);
  await expect(page.getByRole("button", { name: "Edit Quote title" })).toContainText("Bibliothèque sur mesure");
  await expect(page.getByTestId("quote-line")).toHaveCount(1);

  // The source is unchanged.
  await page.goto(`/quotes?id=${source.id}`);
  await expect(page.getByRole("button", { name: "Edit Quote title" })).toContainText("Bibliothèque agrandie");
  await expect(page.getByRole("button", { name: "Choose or edit Customer" })).toContainText("Maison des Tilleuls");
});

test("the workspace action waits for saves and assistant changes", async ({ artisan }) => {
  const { page } = artisan;
  const source = await createCompleteQuote(artisan);
  let failSave = true;
  let releaseAssistant!: () => void;
  const assistantResponse = new Promise<void>((resolve) => { releaseAssistant = resolve; });
  await page.goto(`/quotes?id=${source.id}`);
  await page.route("**/api/quotes**", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    if (payload?.action === "save" && failSave) {
      failSave = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "connection_failed" }) });
      return;
    }
    if (payload?.action === "assistant") {
      await assistantResponse;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "assistant_unavailable" }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Edit line 1" }).click();
  await page.getByLabel("Amount").fill("150.00");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Not saved" })).toBeVisible();
  await page.getByRole("button", { name: "More Quote actions" }).click();
  await expect(page.getByRole("menuitem", { name: "New Quote from the Working Draft" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByLabel("Your message").fill("Change the title.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Preparing the change. You can keep editing.")).toBeVisible();
  await page.getByRole("button", { name: "More Quote actions" }).click();
  await expect(page.getByRole("menuitem", { name: "New Quote from the Working Draft" })).toBeDisabled();
  await page.keyboard.press("Escape");

  releaseAssistant();
  await expect(page.getByText("The assistant did not respond")).toBeVisible();
  await page.getByRole("button", { name: "More Quote actions" }).click();
  await expect(page.getByRole("menuitem", { name: "New Quote from the Working Draft" })).toBeEnabled();
});

test("from the list, a Quote with one version is copied at once and several versions ask which", async ({ artisan }) => {
  const { page } = artisan;
  const single = await createCompleteQuote(artisan);
  const several = await publishWithPendingDraft(artisan);
  await page.goto("/quotes");

  await row(page, single.draft.reference).getByRole("button", { name: /^Actions for Quote/ }).click();
  await page.getByRole("menuitem", { name: "New Quote from…" }).click();
  await expectStartedQuote(page, `Started from ${single.draft.reference}, Working Draft`, single.id);
  await expect(page.getByRole("button", { name: "Edit Quote title" })).toContainText("Bibliothèque sur mesure");

  await page.goto("/quotes");
  await row(page, several.draft.reference).getByRole("button", { name: /^Actions for Quote/ }).click();
  await page.getByRole("menuitem", { name: "New Quote from…" }).click();
  const dialog = page.getByRole("dialog", { name: "New Quote from…" });
  const options = dialog.getByRole("radio");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAccessibleName("Working Draft");
  await expect(options.nth(1)).toHaveAccessibleName("Revision 1");
  await expect(options.nth(0)).toHaveAccessibleDescription(/^Last edited .+ · CHF 172\.96 incl\. VAT · 2 lines$/);
  await expect(options.nth(1)).toHaveAccessibleDescription(/^Published .+ · CHF 108\.10 incl\. VAT · 1 line$/);
  for (const option of await options.all()) await expect(option).not.toBeChecked();
  const create = dialog.getByRole("button", { name: "Create Quote" });
  await expect(create).toBeDisabled();

  await dialog.getByText("Revision 1").click();
  await expect(options.nth(1)).toBeChecked();
  await create.click();
  await expectStartedQuote(page, `Started from ${several.draft.reference}, Revision 1`, several.id);
  await expect(page.getByRole("button", { name: "Edit Quote title" })).toContainText("Bibliothèque sur mesure");

  // Cancelling creates nothing.
  await page.goto("/quotes");
  const rows = await page.locator(".qp-list-row").count();
  await row(page, several.draft.reference).getByRole("button", { name: /^Actions for Quote/ }).click();
  await page.getByRole("menuitem", { name: "New Quote from…" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".qp-list-row")).toHaveCount(rows);
});

test("an Archived Quote is a source from the list in French", async ({ artisan }) => {
  const { page } = artisan;
  const source = await createEmptyQuote(artisan);
  expect((await requestQuote(artisan, { action: "archive", id: source.id, requestId: crypto.randomUUID() })).ok).toBe(true);
  await setInterfaceLanguage(page, "fr");
  await page.goto("/quotes");
  await page.getByRole("tab", { name: "Archivés" }).click();
  await row(page, source.draft.reference).getByRole("button", { name: /^Actions du devis/ }).click();
  await page.getByRole("menuitem", { name: "Nouveau devis à partir de…" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Créé à partir de ${source.draft.reference}, brouillon de travail` })).toBeVisible();
  await expect(page.getByText("Brouillon de travail", { exact: true })).toBeVisible();
  await expect(page.locator(".qp-archived-banner")).toHaveCount(0);

  await page.goto("/quotes");
  await page.getByRole("tab", { name: "Archivés" }).click();
  await expect(row(page, source.draft.reference)).toBeVisible();
});
