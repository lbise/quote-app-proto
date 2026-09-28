import { expect, test } from "./fixtures";

test("an Artisan can open and edit Quotes without the secure-context UUID API", async ({ browser, browserAuth }) => {
  const context = await browser.newContext({ locale: "en-US", storageState: browserAuth.storageState });
  // Plain HTTP on a LAN or Tailscale IP has getRandomValues, but not randomUUID.
  await context.addInitScript(() => {
    if (window.isSecureContext) {
      Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
    }
  });
  const page = await context.newPage();
  const requestIds: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/quotes" && request.method() === "POST") {
      requestIds.push(request.postDataJSON().requestId);
    }
  });
  try {
    await page.goto("/quotes");
    await expect(page.locator("body")).not.toContainText("crypto.randomUUID is not a function");
    await expect(page.getByRole("heading", { name: "My Quotes" })).toBeVisible();
    await page.getByRole("button", { name: "New Quote", exact: true }).click();
    await expect(page).toHaveURL(/\/quotes\?id=.+/);
    await page.getByRole("button", { name: "Add a line" }).click();
    await page.getByLabel("Description").fill("HTTP access regression fixture");
    await page.getByLabel("Pricing mode").selectOption("fixed");
    await page.getByLabel("Amount").fill("42.00");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("HTTP access regression fixture")).toBeVisible();
    await expect(page.getByText(/CHF\s*42\.00/)).toBeVisible();

    await page.getByRole("button", { name: "Add section", exact: true }).click();
    await page.getByLabel("New section name").fill("HTTP section fixture");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    const quoteUrl = page.url();
    await page.getByRole("link", { name: "Customers" }).click();
    await page.getByRole("link", { name: "New Customer", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("HTTP Customer fixture");
    await page.getByLabel("Address", { exact: true }).fill("Rue Exemple 1");
    await page.getByRole("button", { name: "Create Customer" }).click();
    await expect(page.getByRole("status")).toHaveText("Customer created.");
    await page.goto(quoteUrl);
    await page.getByRole("article").getByRole("button", { name: "Choose or edit Customer" }).click();
    const quoteCustomer = page.getByRole("dialog", { name: "Quote Customer" });
    const saved = quoteCustomer.getByLabel("Saved Customer");
    await saved.selectOption(await saved.getByRole("option", { name: /HTTP Customer fixture/ }).getAttribute("value") ?? "");
    await quoteCustomer.getByRole("button", { name: "Apply to Quote" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("HTTP Customer fixture", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "HTTP section fixture", exact: true })).toBeVisible();
    expect(requestIds.length).toBeGreaterThanOrEqual(5);
    for (const id of requestIds) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(requestIds).size).toBe(requestIds.length);
  } finally { await context.close(); }
});
