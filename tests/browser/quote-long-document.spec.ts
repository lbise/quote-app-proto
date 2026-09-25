import { createLongQuote, expect, test } from "./fixtures";

test("the long French Quote keeps approved section navigation, focus, and desk geometry across interface languages", async ({ artisan }) => {
  const seeded = await createLongQuote(artisan);
  const { page } = artisan;
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/quotes?id=${seeded.id}`);

  const rail = page.locator("#qp-review-outline");
  const documentPane = page.getByRole("region", { name: "Customer-facing Quote" });
  const conversation = page.getByRole("region", { name: "Conversation with assistant" });
  await expect(rail.getByRole("button", { name: /^Cuisine(?:\s|$)/ })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Organise", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Organise sections", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Section actions Cuisine", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Insert section below", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add section", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add section", exact: true })).toBeVisible();
  await expect(page.locator(".qp-section-add-line")).toHaveCount(0);
  await expect(page.getByText("Ajustage final, joints, caches latéraux et nettoyage des agencements posés.")).toBeVisible();

  const [railBox, documentBox, conversationBox] = await Promise.all([rail.boundingBox(), documentPane.boundingBox(), conversation.boundingBox()]);
  expect(railBox?.width).toBe(176);
  expect(documentBox).not.toBeNull();
  expect(conversationBox).not.toBeNull();
  const quoteRatio = documentBox!.width / (documentBox!.width + conversationBox!.width);
  expect(quoteRatio).toBeCloseTo(0.58, 3);
  expect(conversationBox!.x - documentBox!.x - documentBox!.width).toBe(16);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".qp-app")).toHaveScreenshot("long-quote-desk.png", { animations: "disabled" });

  await page.getByRole("button", { name: "Section actions Cuisine", exact: true }).click();
  await expect(page.getByRole("button", { name: "Insert section below", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Section actions Cuisine", exact: true })).toBeFocused();

  const scrollableQuote = page.getByRole("region", { name: "Scrollable Quote content" });
  expect(await scrollableQuote.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  const collapse = page.getByRole("button", { name: "Collapse sections" });
  await collapse.click();
  await expect(rail.getByRole("button", { name: /^Cuisine(?:\s|$)/ })).toBeHidden();
  expect((await rail.boundingBox())?.width).toBe(52);

  const expand = page.getByRole("button", { name: "Expand sections" });
  await expect(expand).toBeFocused();
  await expand.click();
  await expect(page.getByRole("button", { name: "Collapse sections" })).toBeFocused();
  const laundry = rail.getByRole("button", { name: /^Buanderie(?:\s|$)/ });
  await laundry.click();
  await expect(laundry).toHaveAttribute("aria-current", "true");

  await page.getByLabel("Interface language / Langue de l’interface").selectOption("fr");
  await expect(page.getByRole("button", { name: "Mes devis" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réduire les sections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agencements intérieurs sur mesure" })).toBeVisible();
  await expect(page.locator(".qp-quote-section h3").filter({ hasText: "Cuisine" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Organiser", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Organiser les sections", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions de section Cuisine", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter une section", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Actions de section Cuisine", exact: true }).click();
  await expect(page.getByRole("button", { name: "Insérer une section après celle-ci", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Actions de section Cuisine", exact: true })).toBeFocused();
});
