import type { Browser } from "@playwright/test";
import { createUser, password, signedInContext } from "./admin-support";
import { expect, test } from "./fixtures";

/** Sign in through the sign-in page. */
async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  return { context, page };
}

test("the admin area is hidden from Artisans who are not Administrators", async ({ artisan }) => {
  await expect(artisan.page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(artisan.page.getByRole("link", { name: "Administration" })).toHaveCount(0);

  const response = await artisan.page.goto("/admin");
  expect(response?.status()).toBe(404);
});

test("an Administrator blocks a User, who can no longer sign in, then unblocks them", async ({ browser }) => {
  const administrator = await createUser("Admin Area Administrator", { administrator: true });
  const target = await createUser("Admin Area Artisan");
  const context = await signedInContext(browser, administrator.email);
  const admin = { context, page: await context.newPage() };
  try {
    await admin.page.goto("/quotes");
    await admin.page.getByRole("link", { name: "Administration" }).click();
    await expect(admin.page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();

    const row = admin.page.getByRole("row").filter({ hasText: target.email });
    await expect(row).toContainText("Active");
    await row.getByRole("button", { name: "Block" }).click();
    const dialog = admin.page.getByRole("alertdialog");
    await expect(dialog).toContainText(target.email);
    await dialog.getByRole("button", { name: "Block" }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toContainText("Blocked");
    await expect(admin.page.getByRole("region", { name: "Administrator actions" })).toContainText(`${administrator.email} blocked ${target.email}`);

    const blocked = await signIn(browser, target.email);
    try {
      await expect(blocked.page.getByText("Your access to Easy Quote has been blocked.", { exact: false })).toBeVisible();
      await expect(blocked.page).toHaveURL(/\/sign-in$/);
    } finally { await blocked.context.close(); }

    await row.getByRole("button", { name: "Unblock" }).click();
    await admin.page.getByRole("alertdialog").getByRole("button", { name: "Unblock" }).click();
    await expect(row).toContainText("Active");

    const restored = await signIn(browser, target.email);
    try {
      await expect(restored.page).toHaveURL(/\/quotes$/);
    } finally { await restored.context.close(); }
  } finally { await admin.context.close(); }
});
