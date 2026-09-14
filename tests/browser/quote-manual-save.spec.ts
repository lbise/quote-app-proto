import { expect, test } from "./fixtures";

test("an Artisan can save a manually added Quote Line and reopen the Working Draft", async ({ artisan }) => {
  const { page } = artisan;

  await page.goto("/quotes");
  await expect(page.getByRole("heading", { name: "My Quotes" })).toBeVisible();

  await page.getByRole("button", { name: "New Quote", exact: true }).click();
  await expect(page).toHaveURL(/\/quotes\?id=.+/);

  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Description").fill("Étagère en chêne avec fixations invisibles.");
  await page.getByLabel("Pricing mode").selectOption("fixed");
  await page.getByLabel("Amount").fill("420.00");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit line 1" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Étagère en chêne avec fixations invisibles.")).toBeVisible();
  await expect(page.getByText(/CHF\s*420\.00/)).toBeVisible();
});
