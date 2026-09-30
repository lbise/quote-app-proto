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
  await expect(page.getByRole("table")).toContainText(seeded.draft.reference);
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
