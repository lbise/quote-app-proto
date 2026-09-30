import { signedInContext } from "./admin-support";
import { createCompleteQuote, expect, test } from "./fixtures";

test("the application opens on the Quotes list with labelled navigation on every page", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan);
  await page.goto("/");
  await expect(page).toHaveURL(/\/quotes$/);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Quotes" })).toHaveAttribute("aria-current", "page");

  // Inside a Quote the navigation stays, and a breadcrumb names the Quote.
  await page.goto(`/quotes?id=${seeded.id}`);
  await expect(navigation.getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Quotes" })).toHaveAttribute("aria-current", "true");
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb).toContainText(seeded.draft.reference);
  await expect(breadcrumb).toContainText("Bibliothèque sur mesure");

  // Archive and delete live in the labelled More menu of the toolbar.
  await page.getByRole("button", { name: "More Quote actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete…" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(navigation.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More Quote actions" })).toBeVisible();
  await breadcrumb.getByRole("link", { name: "My Quotes" }).click();
  await expect(page.locator(".eq-quote-item").filter({ hasText: seeded.draft.reference })).toBeVisible();
});

test("phones list Quotes grouped by what is left to do, or as the table when chosen", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan, "1000.00");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/quotes");
  const toFinish = page.getByRole("region", { name: /^To finish/ });
  const item = toFinish.getByRole("listitem").filter({ hasText: seeded.draft.reference });
  await expect(item.getByRole("link")).toContainText("Bibliothèque sur mesure");
  await expect(item.getByRole("link")).toContainText("Maison des Tilleuls SA");
  await expect(item.getByRole("link")).toContainText("1’081.00");
  await expect(item.locator(".eq-status")).toHaveAttribute("data-status", "working-draft");
  await expect(page.getByRole("table")).toBeHidden();
  // One New Quote button, fixed above the bottom tab bar.
  const create = page.getByRole("button", { name: "New Quote" });
  await expect(create).toHaveCount(1);
  const [button, tabs] = await Promise.all([create.boundingBox(), page.getByRole("navigation", { name: "Main navigation" }).boundingBox()]);
  expect(button!.y + button!.height).toBeLessThanOrEqual(tabs!.y);
  await item.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`id=${seeded.id}`));

  await page.context().addCookies([{ name: "eq-look", value: encodeURIComponent("mobileList=table"), url: page.url() }]);
  await page.goto("/quotes");
  await expect(page.getByRole("table")).toContainText(seeded.draft.reference);
  await expect(page.getByRole("region", { name: /^To finish/ })).toBeHidden();
  await page.context().clearCookies({ name: "eq-look" });
});

test("on phones a Customer opens on its own screen with a way back to the list", async ({ artisan }) => {
  const { page } = artisan;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers?id=new");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Search Customers")).toBeHidden();
  await page.getByRole("link", { name: "Back to Customers" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByLabel("Search Customers")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Customers" })).toBeHidden();
});

test("the Quote list is a table with the listed total", async ({ artisan }) => {
  const { page } = artisan;
  const seeded = await createCompleteQuote(artisan, "1000.00");
  await page.goto("/quotes");
  const row = page.locator(".qp-list-row").filter({ has: page.getByRole("cell", { name: seeded.draft.reference, exact: true }) });
  await expect(row.getByRole("cell").nth(4)).toHaveText("1’081.00");
  await expect(row.locator(".eq-status")).toHaveAttribute("data-status", "working-draft");
  await row.getByRole("cell", { name: seeded.draft.reference, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`id=${seeded.id}`));
});

test("the account menu changes the theme and signs out", async ({ browser, artisan }) => {
  // A session of its own: signing out ends only this session, not the one the
  // other tests share. No new User, so registration stays under its rate limit.
  const context = await signedInContext(browser, artisan.email);
  const page = await context.newPage();
  await page.goto("/quotes");
  const html = page.locator("html");
  await page.getByRole("button", { name: /^Account\b/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-theme-resolved", "dark");
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme-resolved", "dark");

  await page.getByRole("button", { name: /^Account\b/ }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-theme-resolved", "light");
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: /^Account\b/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await context.close();
});
