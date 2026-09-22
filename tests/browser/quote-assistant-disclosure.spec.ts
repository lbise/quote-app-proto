import { createCompleteQuote, expect, test } from "./fixtures";

test("the assistant data warning is available from the chat header without blocking messages", async ({ artisan }) => {
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

  const privacy = page.getByRole("button", { name: "Assistant data and privacy" });
  await expect(privacy).toBeVisible();
  await privacy.click();
  await expect(page.getByRole("heading", { name: "Assistant data processing" })).toBeVisible();
  await expect(page.getByText("Google Gemini Developer API")).toBeVisible();
  await expect(page.getByText("This is broader sharing than the earlier work-only context.")).toBeVisible();
  await expect(page.getByText("The assistant sends your current message, recent conversation and the complete current Working Draft")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gemini API terms" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();

  await page.getByLabel("Your message").fill("Please revise the title.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toContainText("The assistant did not respond");
  expect(assistantCalls).toBe(1);
  await expect(page.getByRole("button", { name: "Edit line 1" })).toBeEnabled();
});

test("failed-call diagnostics are visible after an assistant response", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.route("**/api/quotes**", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    if (payload?.action !== "assistant") return route.continue();
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "assistant_unavailable",
        details: { diagnostic: { phase: "tool", code: "tool_rejected", failedCalls: 1, failureLimit: 3, outcome: "unchanged_with_failed_calls", attempts: [] } },
      }),
    });
  });

  await page.getByLabel("Your message").fill("Please revise the title.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alert")).toContainText("The assistant did not respond");
  const debugTrigger = page.getByRole("button", { name: "Developer details" });
  await debugTrigger.click();
  const debugDialog = page.getByRole("dialog");
  await expect(debugDialog).toBeVisible();
  await expect(debugDialog).toContainText("Failed calls: 1/3");
  const bounds = await debugDialog.boundingBox();
  expect(bounds?.width ?? 0).toBeGreaterThan(680);
  await debugDialog.getByRole("button", { name: "Close" }).click();
  await expect(debugDialog).toHaveCount(0);
});

test("an assistant publication request does not open the Publication dialog", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.route("**/api/quotes**", async (route) => {
    const payload = route.request().postDataJSON() as { action?: string } | null;
    if (payload?.action !== "assistant") return route.continue();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...seeded,
        messages: [{ role: "assistant", fr: "Publication contrôlée manuellement.", en: "Publication stays manual.", changed: [] }],
        assistantRequest: { requestId: "browser-publication-request", text: "Publish this Quote.", status: "complete", baseVersion: seeded.version },
      }),
    });
  });

  await page.getByLabel("Your message").fill("Publish this Quote.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Publication stays manual.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Enter sends and Ctrl+Enter inserts a new line", async ({ artisan }) => {
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

  const message = page.getByLabel("Your message");
  await message.fill("First line");
  await message.press("Control+Enter");
  await expect(message).toHaveValue("First line\n");
  expect(assistantCalls).toBe(0);

  await message.press("Enter");
  await expect(page.getByRole("alert")).toContainText("The assistant did not respond");
  expect(assistantCalls).toBe(1);
});
