import { createCompleteQuote, expect, test } from "./fixtures";

test("the first assistant send requires privacy confirmation and leaves manual editing available after failure", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;
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
  await expect(page.getByText("Messages and descriptions may still contain personal information.")).toBeVisible();
  expect(assistantCalls).toBe(0);

  await page.getByRole("button", { name: "Continue and send" }).click();
  await expect(page.getByRole("alert")).toContainText("The assistant did not respond");
  expect(assistantCalls).toBe(1);
  await expect(page.getByRole("button", { name: "Edit line 1" })).toBeEnabled();
});
