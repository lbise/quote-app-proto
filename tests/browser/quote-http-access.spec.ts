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

    await page.getByRole("button", { name: "Add a section" }).click();
    const sections = page.getByRole("dialog");
    await sections.getByRole("button", { name: "Add", exact: true }).click();
    await sections.getByLabel("Section name 1").fill("HTTP section fixture");
    await sections.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Customers & business" }).click();
    const customer = page.getByRole("region", { name: "Customer record" });
    await customer.getByRole("textbox", { name: "Name", exact: true }).fill("HTTP Customer fixture");
    await customer.getByRole("textbox", { name: "Address", exact: true }).fill("Rue Exemple 1");
    await page.getByRole("button", { name: "Create Customer" }).click();
    await page.getByLabel("Choose a Customer").selectOption({ label: "HTTP Customer fixture" });
    await page.getByRole("button", { name: "Use this Customer" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("HTTP Customer fixture", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /HTTP section fixture/ })).toBeVisible();
    expect(requestIds.length).toBeGreaterThanOrEqual(5);
    for (const id of requestIds) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(requestIds).size).toBe(requestIds.length);
  } finally { await context.close(); }
});
