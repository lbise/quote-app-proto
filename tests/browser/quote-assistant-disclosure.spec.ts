import { createCompleteQuote, expect, test } from "./fixtures";

test.use({ fictionalAssistantDisclosure: true });

test("the fictional assistant disclosure requires confirmation and leaves manual editing available after failure", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  let assistantCalls = 0;

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.route("**/api/quotes**", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    if (payload?.action !== "assistant") return route.continue();
    assistantCalls += 1;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "assistant_unavailable" }) });
  });

  await page.getByLabel("Your message").fill("Please revise the title.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Assistant data processing" })).toBeVisible();
  await expect(page.getByText("Google Gemini Developer API")).toBeVisible();
  await expect(page.getByText("This instance runs the isolated fictional test.")).toBeVisible();
  await expect(page.getByText("Unpaid Gemini services may use content for product improvement and human review.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gemini API terms" })).toBeVisible();
  expect(assistantCalls).toBe(0);

  await page.getByRole("button", { name: "Continue and send" }).click({ force: true });
  await expect(page.getByRole("alert")).toContainText("The assistant did not respond");
  expect(assistantCalls).toBe(1);
  await expect(page.getByRole("button", { name: "Edit line 1" })).toBeEnabled();
});

test("the disabled browser server disclosure sends no Quote content and offers no continuation", async ({ browser, browserAuth }) => {
  const context = await browser.newContext({ locale: "en-US", storageState: browserAuth.storageState });
  const page = await context.newPage();
  try {
    await page.goto("/quotes");
    await page.getByRole("button", { name: "Assistant privacy" }).click();
    await expect(page.getByText("Hosted AI is disabled. Easy Quote does not send Quote content to an AI provider.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue and send" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
