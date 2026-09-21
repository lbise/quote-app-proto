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
