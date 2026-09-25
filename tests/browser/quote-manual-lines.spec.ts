import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const interfaces = {
  en: {
    newQuote: "New Quote", add: "Add a line", edit: "Edit line", dialog: /^(?:Add a line|Edit quote line \d+)$/,
    more: "More actions for line",
    mode: "Pricing mode", quantity: "Quantity", unit: "Unit", price: "Unit price", amount: "Amount",
    apply: "Apply", cancel: "Cancel", saved: "Saved", notSaved: "Not saved", retry: "Retry", undo: /^Undo/,
    up: "Move up line", down: "Move down line", duplicate: "Duplicate line", delete: "Delete line",
    positive: "Quantity must be greater than zero.", negative: "The value cannot be negative.",
    precision: "This precision is not supported.", invalid: "Enter a valid value.",
  },
  fr: {
    newQuote: "Nouveau devis", add: "Ajouter une ligne", edit: "Modifier la ligne", dialog: /^(?:Ajouter une ligne|Modifier la ligne \d+)$/,
    more: "Autres actions de la ligne",
    mode: "Mode de prix", quantity: "Quantité", unit: "Unité", price: "Prix unitaire", amount: "Montant",
    apply: "Appliquer", cancel: "Annuler", saved: "Enregistré", notSaved: "Non enregistré", retry: "Réessayer", undo: /^Annuler/,
    up: "Monter la ligne", down: "Descendre la ligne", duplicate: "Dupliquer la ligne", delete: "Supprimer la ligne",
    positive: "La quantité doit être supérieure à zéro.", negative: "La valeur ne peut pas être négative.",
    precision: "La précision indiquée n'est pas prise en charge.", invalid: "Indiquez une valeur valide.",
  },
} as const;

type Copy = typeof interfaces[keyof typeof interfaces];

// Observe real authenticated requests; do not replace the persistence boundary.
// Waiting for the action response also avoids mistaking an earlier Saved status
// for completion of the current edit or Undo.
async function persist(page: Page, copy: Copy, action: "save" | "undo", trigger: () => Promise<unknown>) {
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/quotes" &&
    response.request().method() === "POST" &&
    response.request().postDataJSON()?.action === action);
  await trigger();
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole("status")).toHaveText(copy.saved);
}

async function addFixedLine(page: Page, copy: Copy, description: string, amount: string) {
  await page.getByRole("button", { name: copy.add, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: copy.dialog, exact: true });
  await dialog.getByLabel("Description", { exact: true }).fill(description);
  await dialog.getByLabel(copy.mode, { exact: true }).selectOption("fixed");
  await dialog.getByLabel(copy.amount, { exact: true }).fill(amount);
  await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
}

async function openLineActions(page: Page, copy: Copy, number: number) {
  const trigger = page.getByRole("button", { name: `${copy.more} ${number}`, exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
}

async function chooseLineAction(page: Page, copy: Copy, number: number, action: "up" | "down" | "duplicate" | "delete") {
  await openLineActions(page, copy, number);
  await page.getByRole("menuitem", { name: `${copy[action]} ${number}`, exact: true }).click();
}

async function expectLines(page: Page, descriptions: string[]) {
  const lines = page.getByTestId("quote-line");
  await expect(lines).toHaveCount(descriptions.length);
  await expect(lines).toContainText(descriptions);
  for (let index = 0; index < descriptions.length; index++) {
    await expect(lines.nth(index).getByText(String(index + 1).padStart(2, "0"), { exact: true })).toBeVisible();
  }
}

async function expectInvalid(dialog: Locator, field: string, value: string, message: string, copy: Copy) {
  const input = dialog.getByLabel(field, { exact: true });
  await input.fill(value);
  await dialog.getByRole("button", { name: copy.apply, exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(value);
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(message);
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
}

for (const locale of ["en", "fr"] as const) {
  const copy = interfaces[locale];

  test.describe(`manual Quote Lines, ${locale}`, () => {
    test.beforeEach(async ({ artisan }) => {
      const { page } = artisan;
      // Search appears after the hydrated page has loaded the Quote list.
      await expect(page.getByRole("textbox", { name: /Search Quotes|Rechercher un devis/ })).toBeVisible();
      await page.getByLabel("Interface language / Langue de l’interface").selectOption(locale);
      await page.getByRole("button", { name: copy.newQuote, exact: true }).click();
      await expect(page).toHaveURL(/\/quotes\?id=.+/);
    });

    test("invalid prices keep the editor open and focus the field until corrected", async ({ artisan }) => {
      const { page } = artisan;
      const dialog = page.getByRole("dialog", { name: copy.dialog, exact: true });
      const description = "Habillage mural en chêne, finition huilée.\nDécoupe autour des prises et ajustage des angles sur place.\nFixations invisibles, protection du sol et nettoyage compris.";
      const add = page.getByRole("button", { name: copy.add, exact: true });
      await add.focus();
      await page.keyboard.press("Enter");
      await dialog.getByLabel("Description", { exact: true }).fill(description);
      await dialog.getByLabel(copy.unit, { exact: true }).fill("m²");
      await dialog.getByLabel(copy.price, { exact: true }).fill("10.00");

      await expectInvalid(dialog, copy.quantity, "0", copy.positive, copy);
      await expectInvalid(dialog, copy.quantity, "1,0001", copy.precision, copy);
      await dialog.getByLabel(copy.quantity, { exact: true }).fill("1,005");
      await expect(dialog.getByLabel(copy.quantity, { exact: true })).toHaveAttribute("aria-invalid", "false");
      await expect(dialog.getByText(copy.precision, { exact: true })).toBeHidden();
      await expectInvalid(dialog, copy.price, "-5", copy.negative, copy);
      await expectInvalid(dialog, copy.price, "10.001", copy.precision, copy);
      await expectInvalid(dialog, copy.price, "abc", copy.invalid, copy);
      await dialog.getByLabel(copy.price, { exact: true }).fill("1.00");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await expect(dialog).toBeHidden();
      await expect(add).toBeFocused();
      // 1.005 × CHF 1.00 rounds half-up to CHF 1.01, despite missing admin details.
      await expect(page.getByText("CHF 1.01", { exact: true })).toBeVisible();
      await expect(page.getByTestId("quote-line").getByText("1.01", { exact: true })).toBeVisible();

      await page.reload();
      const edit = page.getByRole("button", { name: `${copy.edit} 1`, exact: true });
      await edit.click();
      await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(description);
      await expect(dialog.getByLabel(copy.quantity, { exact: true })).toHaveValue("1,005");
      await expect(dialog.getByLabel(copy.price, { exact: true })).toHaveValue("1.00");
      await dialog.getByLabel(copy.mode, { exact: true }).selectOption("fixed");
      await expect(dialog.getByLabel(copy.quantity, { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel(copy.unit, { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel(copy.price, { exact: true })).toHaveCount(0);
      await expectInvalid(dialog, copy.amount, "-1", copy.negative, copy);
      await expectInvalid(dialog, copy.amount, "25,501", copy.precision, copy);
      await dialog.getByLabel(copy.amount, { exact: true }).fill("25,50");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await expect(edit).toBeFocused();
      await expect(edit).toBeInViewport();
      await expect(page.getByText("CHF 25.50", { exact: true })).toBeVisible();
      await expect(page.getByTestId("quote-line").getByText("25.50", { exact: true })).toBeVisible();

      await page.reload();
      await edit.click();
      await expect(dialog.getByLabel(copy.mode, { exact: true })).toHaveValue("fixed");
      await expect(dialog.getByLabel(copy.amount, { exact: true })).toHaveValue("25,50");
      await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(description);
      await dialog.getByLabel("Description", { exact: true }).fill("Modification abandonnée");
      await dialog.getByLabel(copy.amount, { exact: true }).fill("99");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(edit).toBeFocused();
      await page.reload();
      await expect(page.getByText("CHF 25.50", { exact: true })).toBeVisible();
      await edit.click();
      await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(description);
      await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
      await expect(edit).toBeFocused();
    });

    test("reordering keeps focus on the moved line and Undo restores only the latest edit", async ({ artisan }) => {
      const { page } = artisan;
      await addFixedLine(page, copy, "Protection du chantier", "10");
      await addFixedLine(page, copy, "Pose des panneaux", "20");
      await addFixedLine(page, copy, "Nettoyage final", "30");
      await expect(page.getByRole("menuitem")).toHaveCount(0);
      await openLineActions(page, copy, 1);
      await expect(page.getByRole("menuitem", { name: `${copy.up} 1`, exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: `${copy.more} 1`, exact: true })).toBeFocused();
      await openLineActions(page, copy, 3);
      await expect(page.getByRole("menuitem", { name: `${copy.down} 3`, exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");

      await openLineActions(page, copy, 1);
      const down = page.getByRole("menuitem", { name: `${copy.down} 1`, exact: true });
      await down.focus();
      await persist(page, copy, "save", () => page.keyboard.press("Enter"));
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeInViewport();
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Nettoyage final"]);
      await page.reload();
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Nettoyage final"]);
      await expect(page.getByText("CHF 60.00", { exact: true })).toBeVisible();

      await persist(page, copy, "save", () => chooseLineAction(page, copy, 3, "up"));
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeInViewport();
      await expectLines(page, ["Pose des panneaux", "Nettoyage final", "Protection du chantier"]);
      await page.reload();
      await expectLines(page, ["Pose des panneaux", "Nettoyage final", "Protection du chantier"]);
      await persist(page, copy, "undo", () => page.getByRole("button", { name: copy.undo }).click());
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Nettoyage final"]);
      await page.reload();
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Nettoyage final"]);
      await expect(page.getByRole("button", { name: copy.undo })).toBeDisabled();

      await persist(page, copy, "save", () => chooseLineAction(page, copy, 2, "duplicate"));
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Protection du chantier", "Nettoyage final"]);
      await expect(page.getByText("CHF 70.00", { exact: true })).toBeVisible();
      await page.reload();
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Protection du chantier", "Nettoyage final"]);
      // Edit the copy by its current number, not the original or its former position.
      await page.getByRole("button", { name: `${copy.edit} 3`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: copy.dialog, exact: true });
      await dialog.getByLabel("Description", { exact: true }).fill("Protection de l'escalier");
      await dialog.getByLabel(copy.amount, { exact: true }).fill("15");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Protection de l'escalier", "Nettoyage final"]);
      await expect(page.getByTestId("quote-line").filter({ hasText: "Protection du chantier" }).getByText("10.00", { exact: true })).toBeVisible();
      await expect(page.getByTestId("quote-line").filter({ hasText: "Protection de l'escalier" }).getByText("15.00", { exact: true })).toBeVisible();
      await expect(page.getByText("CHF 75.00", { exact: true })).toBeVisible();
      await page.reload();
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Protection de l'escalier", "Nettoyage final"]);
      await persist(page, copy, "undo", () => page.getByRole("button", { name: copy.undo }).click());
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Protection du chantier", "Nettoyage final"]);
      await expect(page.getByText("CHF 70.00", { exact: true })).toBeVisible();
      await page.reload();
      await expectLines(page, ["Pose des panneaux", "Protection du chantier", "Protection du chantier", "Nettoyage final"]);
      await expect(page.getByText("CHF 70.00", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: copy.undo })).toBeDisabled();
    });

    test("deleting focuses the next line, then the previous line, then Add, and can be undone after reopening", async ({ artisan }) => {
      const { page } = artisan;
      await addFixedLine(page, copy, "Protection du chantier", "10");
      await addFixedLine(page, copy, "Pose des panneaux", "20");
      await addFixedLine(page, copy, "Nettoyage final", "30");

      await openLineActions(page, copy, 2);
      const removeMiddle = page.getByRole("menuitem", { name: `${copy.delete} 2`, exact: true });
      await removeMiddle.focus();
      await persist(page, copy, "save", () => page.keyboard.press("Enter"));
      await expectLines(page, ["Protection du chantier", "Nettoyage final"]);
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeInViewport();
      await expect(page.getByText("CHF 40.00", { exact: true })).toBeVisible();
      await page.reload();
      await expectLines(page, ["Protection du chantier", "Nettoyage final"]);
      await persist(page, copy, "undo", () => page.getByRole("button", { name: copy.undo }).click());
      await expectLines(page, ["Protection du chantier", "Pose des panneaux", "Nettoyage final"]);
      await expect(page.getByText("CHF 60.00", { exact: true })).toBeVisible();
      await page.reload();
      await expectLines(page, ["Protection du chantier", "Pose des panneaux", "Nettoyage final"]);

      await persist(page, copy, "save", () => chooseLineAction(page, copy, 3, "delete"));
      await expectLines(page, ["Protection du chantier", "Pose des panneaux"]);
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeInViewport();
      await page.reload();
      await expectLines(page, ["Protection du chantier", "Pose des panneaux"]);
      await persist(page, copy, "save", () => chooseLineAction(page, copy, 2, "delete"));
      await expectLines(page, ["Protection du chantier"]);
      await expect(page.getByRole("button", { name: `${copy.edit} 1`, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: `${copy.edit} 1`, exact: true })).toBeInViewport();
      await persist(page, copy, "save", () => chooseLineAction(page, copy, 1, "delete"));
      await expect(page.getByTestId("quote-line")).toHaveCount(0);
      await expect(page.getByRole("button", { name: copy.add, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: copy.add, exact: true })).toBeInViewport();
      await page.reload();
      await expect(page.getByRole("heading", { name: "Les travaux apparaîtront ici." })).toBeVisible();
      await expect(page.getByTestId("quote-line")).toHaveCount(0);
      await persist(page, copy, "undo", () => page.getByRole("button", { name: copy.undo }).click());
      await expectLines(page, ["Protection du chantier"]);
      await expect(page.getByText("CHF 10.00", { exact: true })).toBeVisible();
      await page.reload();
      await expectLines(page, ["Protection du chantier"]);
      await expect(page.getByText("CHF 10.00", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: copy.undo })).toBeDisabled();
    });

    test("retrying a deletion after a lost save response preserves the remaining lines and Undo target", async ({ artisan }) => {
      const { page } = artisan;
      await addFixedLine(page, copy, "Protection du chantier", "10");
      await addFixedLine(page, copy, "Pose des panneaux", "20");
      await addFixedLine(page, copy, "Nettoyage final", "30");
      let loseResponse = true;
      await page.route("**/api/quotes", async (route) => {
        if (loseResponse && route.request().method() === "POST" && route.request().postDataJSON()?.action === "save") {
          loseResponse = false;
          // PostgreSQL accepts the deletion before the browser loses its response.
          const saved = await route.fetch();
          expect(saved.ok()).toBe(true);
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "connection_failed" }) });
          return;
        }
        await route.continue();
      });

      await chooseLineAction(page, copy, 2, "delete");
      await expect(page.getByRole("status")).toContainText(copy.notSaved);
      await expectLines(page, ["Protection du chantier", "Nettoyage final"]);
      await expect(page.getByRole("button", { name: `${copy.edit} 2`, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: copy.undo })).toBeDisabled();
      await persist(page, copy, "save", () => page.getByRole("button", { name: copy.retry, exact: true }).click());
      await page.reload();
      await expectLines(page, ["Protection du chantier", "Nettoyage final"]);
      await expect(page.getByText("CHF 40.00", { exact: true })).toBeVisible();
      await persist(page, copy, "undo", () => page.getByRole("button", { name: copy.undo }).click());
      await expectLines(page, ["Protection du chantier", "Pose des panneaux", "Nettoyage final"]);
      await page.reload();
      await expectLines(page, ["Protection du chantier", "Pose des panneaux", "Nettoyage final"]);
      await expect(page.getByText("CHF 60.00", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: copy.undo })).toBeDisabled();
    });

    test("missing pricing stays partial while deliberate zero prices survive mode changes and reload", async ({ artisan }) => {
      const { page } = artisan;
      await addFixedLine(page, copy, "Protection du chantier", "25.50");
      await page.getByRole("button", { name: copy.add, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: copy.dialog, exact: true });
      await dialog.getByLabel("Description", { exact: true }).fill("Ajustage des panneaux");
      await dialog.getByLabel(copy.unit, { exact: true }).fill("");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await expect(page.getByText("Sous-total partiel HT", { exact: true })).toBeVisible();
      await expect(page.getByText("Total à compléter", { exact: true })).toBeVisible();
      await expect(page.getByText("CHF 25.50", { exact: true })).toBeVisible();
      await expect(page.getByTestId("quote-line").nth(1).getByRole('button', { name: locale === 'fr' ? 'Quantité manquante' : 'Quantity missing', exact: true })).toBeVisible();

      await page.reload();
      const edit = page.getByRole("button", { name: `${copy.edit} 2`, exact: true });
      await edit.click();
      for (const field of [copy.quantity, copy.unit, copy.price]) {
        await expect(dialog.getByLabel(field, { exact: true })).toHaveValue("");
        await expect(dialog.getByLabel(field, { exact: true })).toHaveAttribute("aria-invalid", "false");
      }
      await dialog.getByLabel(copy.quantity, { exact: true }).fill("2.5");
      await dialog.getByLabel(copy.unit, { exact: true }).fill("panneau");
      await dialog.getByLabel(copy.price, { exact: true }).fill("0");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await expect(page.getByText("Sous-total HT", { exact: true })).toBeVisible();
      await expect(page.getByText("Sans frais", { exact: true })).toBeVisible();
      await expect(page.getByText("CHF 25.50", { exact: true })).toBeVisible();
      await expect(page.getByTestId("quote-line").nth(1).getByText("0.00", { exact: true })).toBeVisible();

      await page.reload();
      await edit.click();
      await expect(dialog.getByLabel(copy.quantity, { exact: true })).toHaveValue("2.5");
      await expect(dialog.getByLabel(copy.unit, { exact: true })).toHaveValue("panneau");
      await expect(dialog.getByLabel(copy.price, { exact: true })).toHaveValue("0");
      await dialog.getByLabel(copy.mode, { exact: true }).selectOption("fixed");
      await expect(dialog.getByLabel(copy.amount, { exact: true })).toHaveValue("");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await expect(page.getByText("Sous-total partiel HT", { exact: true })).toBeVisible();
      await expect(page.getByText("Sans frais", { exact: true })).toBeHidden();

      await page.reload();
      await edit.click();
      await expect(dialog.getByLabel(copy.mode, { exact: true })).toHaveValue("fixed");
      await expect(dialog.getByLabel(copy.amount, { exact: true })).toHaveValue("");
      await dialog.getByLabel(copy.amount, { exact: true }).fill("0,00");
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await page.reload();
      await expect(page.getByText("Sous-total HT", { exact: true })).toBeVisible();
      await expect(page.getByText("Sans frais", { exact: true })).toBeVisible();
      await expect(page.getByText("CHF 25.50", { exact: true })).toBeVisible();
      await edit.click();
      await expect(dialog.getByLabel(copy.amount, { exact: true })).toHaveValue("0,00");
      await dialog.getByLabel(copy.mode, { exact: true }).selectOption("quantity");
      for (const field of [copy.quantity, copy.unit, copy.price]) {
        await expect(dialog.getByLabel(field, { exact: true })).toHaveValue("");
      }
      await expect(dialog.getByLabel(copy.amount, { exact: true })).toHaveCount(0);
      await persist(page, copy, "save", () => dialog.getByRole("button", { name: copy.apply, exact: true }).click());
      await page.reload();
      await expect(page.getByText("Sous-total partiel HT", { exact: true })).toBeVisible();
      await expect(page.getByText("Total à compléter", { exact: true })).toBeVisible();
      await expect(page.getByText("CHF 25.50", { exact: true })).toBeVisible();
    });
  });
}
