import { createCompleteQuote, expect, test } from "./fixtures";

test("a failed save keeps the manual edit visible and retries it", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  let failSave = true;

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.route("**/api/quotes", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    if (failSave && payload?.action === "save") {
      failSave = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "connection_failed" }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Edit line 1" }).click();
  await page.getByLabel("Amount").fill("150.00");
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByRole("status")).toContainText("Not saved");
  await expect(page.getByText("CHF 162.15", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(page.getByText("CHF 162.15", { exact: true })).toBeVisible();
});
