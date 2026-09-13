import { createCompleteQuote, expect, test } from "./fixtures";

test("using a Customer record copies it into the Working Draft without later record updates rewriting it", async ({ artisan }) => {
  const seeded = await createCompleteQuote(artisan);
  const { page } = artisan;

  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByRole("button", { name: "Customers & business" }).click();
  await expect(page.getByRole("heading", { name: "Customers and defaults" })).toBeVisible();

  const customerRecord = page.getByRole("region", { name: "Customer record" });
  await customerRecord.getByRole("textbox", { name: "Name", exact: true }).fill("Camille Réutilisable");
  await customerRecord.getByRole("textbox", { name: "Address", exact: true }).fill("Rue du Lac 10\n1000 Lausanne");
  await page.getByRole("button", { name: "Create Customer" }).click();
  await page.getByLabel("Choose a Customer").selectOption({ label: "Camille Réutilisable" });
  await page.getByRole("button", { name: "Use this Customer" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByText("Rue du Lac 10")).toBeVisible();

  await page.getByRole("button", { name: "Customers & business" }).click();
  await page.getByLabel("Choose a Customer").selectOption({ label: "Camille Réutilisable" });
  await page.getByRole("region", { name: "Customer record" }).getByRole("textbox", { name: "Address", exact: true }).fill("Rue du Lac 12\n1000 Lausanne");
  await page.getByRole("button", { name: "Update Customer" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await expect(page.getByText("Rue du Lac 10")).toBeVisible();
  await expect(page.getByText("Rue du Lac 12")).toHaveCount(0);
});

test('retrying Customer creation after a lost response creates only one reusable record', async ({ artisan }) => {
  const { page } = artisan;
  await page.goto('/quotes');
  await page.getByRole('button', { name: 'Customers & business' }).click();
  let loseResponse = true;
  await page.route('**/api/quotes', async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.action !== 'customer-save' || !loseResponse) return route.continue();
    loseResponse = false;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.fulfill({ status: 503, json: { error: 'connection_failed' } });
  });
  const record = page.getByRole('region', { name: 'Customer record' });
  await record.getByRole('textbox', { name: 'Name', exact: true }).fill('Customer retry fixture');
  await record.getByRole('textbox', { name: 'Address', exact: true }).fill('Rue Exemple 1');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save the Customer');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await expect(page.getByLabel('Choose a Customer').getByRole('option', { name: 'Customer retry fixture', exact: true })).toHaveCount(1);
});
