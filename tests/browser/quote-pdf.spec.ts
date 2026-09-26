import { readFile } from "node:fs/promises";

import type { Download, Page } from "@playwright/test";

import { firstQuoteExample, firstQuoteExampleNames } from "../../app/lib/first-quote-examples";
import { pdfPages, png } from "../../app/lib/pdf-test-support";
import { createCompleteQuote, createEmptyQuote, expect, requestQuote, test } from "./fixtures";

async function downloaded(page: Page, click: () => Promise<void>): Promise<{ filename: string; pages: string[] }> {
  const [download] = await Promise.all([page.waitForEvent("download"), click()]) as [Download, void];
  return { filename: download.suggestedFilename(), pages: await pdfPages(new Uint8Array(await readFile((await download.path())!))) };
}

test("an Artisan downloads a Draft Preview, publishes, then downloads the Quote Document from the confirmation and from the revision", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  const reference = seeded.draft.reference;
  await page.goto(`/quotes?id=${seeded.id}`);
  await expect(page.getByText("Bibliothèque en chêne avec fixations invisibles.")).toBeVisible();

  const preview = await downloaded(page, () => page.getByRole("button", { name: "PDF preview" }).click());
  expect(preview.filename).toBe(`Devis-${reference}-brouillon.pdf`);
  expect(preview.pages.join(" ")).toContain("BROUILLON");
  expect(preview.pages.join(" ")).toContain("Bibliothèque en chêne avec fixations invisibles.");
  await expect(page.getByText("Working draft")).toBeVisible();

  await page.getByRole("button", { name: "Review & publish" }).click();
  await page.getByRole("button", { name: "Confirm publication" }).click();
  const confirmation = page.getByRole("dialog", { name: "Revision 1 published" });
  await expect(confirmation).toBeVisible();
  const published = await downloaded(page, () => confirmation.getByRole("button", { name: "Download Quote" }).click());
  expect(published.filename).toBe(`Devis-${reference}-r1.pdf`);
  expect(published.pages.join(" ")).not.toContain("BROUILLON");
  expect(published.pages.join(" ")).toContain("108.10");
  await confirmation.getByRole("button", { name: "Close" }).click();

  // A later revision does not replace revision 1's Quote Document.
  await page.getByRole("button", { name: "New revision" }).click();
  await page.getByRole("button", { name: "Edit line 1" }).click();
  await page.getByLabel("Amount").fill("200.00");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review & publish" }).click();
  await page.getByRole("button", { name: "Confirm publication" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Quote version").selectOption({ label: "Revision 1" });
  await expect(page.getByText("Published revision 1")).toBeVisible();
  const first = await downloaded(page, () => page.getByRole("button", { name: "Download PDF" }).click());
  expect(first.filename).toBe(`Devis-${reference}-r1.pdf`);
  expect(first.pages.join(" ")).toContain("108.10");
  expect(first.pages.join(" ")).not.toContain("216.20");
});

test("a Draft Preview notes that an assistant proposal still in progress is not included", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  // Hold the assistant request open so the proposal stays pending while the preview downloads.
  let release: () => void = () => undefined;
  await page.route("**/api/quotes", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "assistant") {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 502, json: { error: "assistant_unavailable" } });
      return;
    }
    await route.continue();
  });
  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByLabel("Your message").fill("Ajoute une étagère.");
  await page.getByRole("button", { name: "Send message" }).click();
  await downloaded(page, () => page.getByRole("button", { name: "PDF preview" }).click());
  await expect(page.getByText("Proposed changes not yet accepted are not in the preview.")).toBeVisible();
  release();
});

test("an Artisan adds, replaces and removes the business logo in the business defaults", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByRole("button", { name: "Customers and defaults" }).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Logo").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>") });
  await expect(dialog.getByText("Choose a PNG or JPEG image.")).toBeVisible();

  await dialog.getByLabel("Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png(40, 20) });
  const logo = dialog.getByRole("img", { name: "Current business logo" });
  await expect(logo).toBeVisible();
  const firstSource = await logo.getAttribute("src");
  await expect(dialog.getByRole("button", { name: "Replace logo" })).toBeVisible();

  await dialog.getByLabel("Logo").setInputFiles({ name: "logo-2.png", mimeType: "image/png", buffer: png(30, 30) });
  await expect(logo).not.toHaveAttribute("src", firstSource!);

  await dialog.getByRole("button", { name: "Remove logo" }).click();
  await expect(logo).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Add logo" })).toBeVisible();
});

test("every example Quote renders as a Quote Document and as a Draft Preview without losing text", async ({ artisan }) => {
  test.setTimeout(120_000);
  for (const name of firstQuoteExampleNames) {
    const example = firstQuoteExample(name);
    const created = await createEmptyQuote(artisan);
    const saved = await requestQuote(artisan, { action: "save", id: created.id, expectedVersion: created.version, requestId: crypto.randomUUID(), quote: example });
    expect(saved.ok, `${name} saves`).toBe(true);
    const preview = await artisan.api.get(`/api/quotes/${created.id}/draft-preview`);
    const detail = saved.data as { id: string; version: number };
    const publication = await requestQuote(artisan, { action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(publication.ok, `${name} publishes`).toBe(true);
    const document = await artisan.api.get(`/api/quotes/${created.id}/revisions/1/document`);

    for (const [kind, response] of [["Draft Preview", preview], ["Quote Document", document]] as const) {
      expect(response.status(), `${name} ${kind}`).toBe(200);
      const pages = await pdfPages(new Uint8Array(await response.body()));
      pages.forEach((page, index) => {
        expect(page, `${name} ${kind} page ${index + 1}`).toContain(`Devis ${example.reference}`);
        expect(page, `${name} ${kind} page ${index + 1}`).toContain(`page ${index + 1}/${pages.length}`);
      });
      const text = pages.join(" ");
      for (const line of example.lines) expect(text, `${name} ${kind}`).toContain(line.description.replace(/\s+/g, " ").trim());
      for (const section of example.sections) expect(text, `${name} ${kind}`).toContain(section.title);
    }
  }
});
