import { createCompleteQuote, expect, test } from "./fixtures";

test("an Artisan publishes revision 1, prepares a new Working Draft, and keeps revision 1 read-only", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;

  await page.goto(`/quotes?id=${seeded.id}`);
  await expect(page.getByText("Bibliothèque en chêne avec fixations invisibles.")).toBeVisible();

  await page.getByRole("button", { name: "Review & publish" }).click();
  await page.getByRole("button", { name: "Confirm publication" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "New revision" })).toBeVisible();
  await expect(page.getByText("Published revision 1")).toBeVisible();

  await page.getByRole("button", { name: "New revision" }).click();
  await expect(page.getByText("Working draft")).toBeVisible();
  await page.getByRole("button", { name: "Edit line 1" }).click();
  await page.getByLabel("Amount").fill("200.00");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Review & publish" }).click();
  await page.getByRole("button", { name: "Confirm publication" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Published revision 2")).toBeVisible();

  await page.getByLabel("Quote version").selectOption({ label: "Revision 1" });
  await expect(page.getByText("Published revision 1")).toBeVisible();
  await expect(page.getByText("CHF 108.10", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit line 1" })).toHaveCount(0);
});
