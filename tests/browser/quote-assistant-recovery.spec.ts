import { createCompleteQuote, expect, test } from "./fixtures";

test("a delayed assistant response becomes stale when the Artisan keeps editing", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
  let assistantStarted!: () => void;
  let releaseAssistant!: () => void;
  const assistantRequest = new Promise<void>((resolve) => { assistantStarted = resolve; });
  const assistantResponse = new Promise<void>((resolve) => { releaseAssistant = resolve; });

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.route("**/api/quotes**", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    if (payload?.action !== "assistant") return route.continue();
    assistantStarted();
    await assistantResponse;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(seeded) });
  });

  await page.getByLabel("Your message").fill("Change the title.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Continue and send" }).click();
  await assistantRequest;
  await expect(page.getByText("Preparing the change. You can keep editing.")).toBeVisible();

  await page.getByRole("button", { name: "Edit line 1" }).click();
  await page.getByLabel("Amount").fill("125.00");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  releaseAssistant();
  await expect(page.getByRole("alert")).toContainText("Your edit is preserved");
  await expect(page.getByText("CHF 135.13", { exact: true })).toBeVisible();
});
