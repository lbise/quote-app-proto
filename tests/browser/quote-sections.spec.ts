import type { Page } from "@playwright/test";
import { createSectionedQuote, expect, setInterfaceLanguage, test } from "./fixtures";

async function persist(page: Page, action: "save" | "undo", trigger: () => Promise<unknown>) {
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/quotes" &&
    candidate.request().method() === "POST" &&
    candidate.request().postDataJSON()?.action === action);
  await trigger();
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText(/Saved|Enregistré/);
}

const translations = {
  en: {
    rename: "Rename section", name: "Section name", actions: "Section actions",
    save: "Save", cancel: "Cancel", up: "Move section up", down: "Move section down",
    duplicate: "Duplicate section and lines", remove: "Remove section (keep lines)",
    delete: "Delete section and its lines", keep: "Keep section",
    addAfter: "Add section after", addEnd: "Add section at end", addEmpty: "Add section",
    addLine: "Add line to", addUngrouped: "Add ungrouped line", addLineEmpty: "Add a line",
    editLine: "Edit line", lineDialog: "Edit quote line", apply: "Apply",
    noSection: "No section", newSectionName: "New section name", add: "Add", undo: /^Undo/,
  },
  fr: {
    rename: "Renommer la section", name: "Nom de section", actions: "Actions de section",
    save: "Enregistrer", cancel: "Annuler", up: "Monter la section", down: "Descendre la section",
    duplicate: "Dupliquer la section et ses lignes", remove: "Retirer la section (garder les lignes)",
    delete: "Supprimer la section et ses lignes", keep: "Conserver la section",
    addAfter: "Ajouter une section après", addEnd: "Ajouter une section à la fin", addEmpty: "Ajouter une section",
    addLine: "Ajouter une ligne à", addUngrouped: "Ajouter une ligne sans section", addLineEmpty: "Ajouter une ligne",
    editLine: "Modifier la ligne", lineDialog: "Modifier la ligne", apply: "Appliquer",
    noSection: "Sans section", newSectionName: "Nom de la nouvelle section", add: "Ajouter", undo: /^Annuler/,
  },
} as const;

for (const locale of ["en", "fr"] as const) {
  const copy = translations[locale];

  test(`inline section editing, actions and Undo in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    // The rail navigates; editing belongs to the document, not a toolbar or modal.
    const rail = page.locator("#qp-review-outline");
    await expect(rail.getByRole("button", { name: /Organise|Organiser/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Organise sections|Organiser les sections|Add a section|Ajouter une section)$/ })).toHaveCount(0);
    await rail.getByRole("button", { name: /^Chambre(?:\s|$)/ }).click();
    await expect(rail.getByRole("button", { name: /^Chambre(?:\s|$)/ })).toHaveAttribute("aria-current", "true");

    const rename = page.getByRole("button", { name: `${copy.rename} Chambre`, exact: true });
    await rename.focus();
    await page.keyboard.press("Enter");
    const name = page.getByRole("textbox", { name: `${copy.name} Chambre`, exact: true });
    await expect(name).toBeFocused();
    await name.fill("Discard this name");
    await page.keyboard.press("Escape");
    await expect(page.locator(".qp-quote-section h3").filter({ hasText: "Chambre" })).toBeVisible();
    await expect(page.locator(".qp-quote-section h3").filter({ hasText: "Discard this name" })).toHaveCount(0);
    await expect(rename).toBeFocused();

    await rename.click();
    await page.getByRole("textbox", { name: `${copy.name} Chambre`, exact: true }).fill("Also discarded");
    await page.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(rename).toBeFocused();
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Chambre", "Bureau"]);

    await rename.click();
    await page.getByRole("textbox", { name: `${copy.name} Chambre`, exact: true }).fill("Chambre nord");
    await persist(page, "save", () => page.getByRole("button", { name: copy.save, exact: true }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Chambre nord", "Bureau"]);
    await expect(rail.getByRole("button", { name: /^Chambre nord(?:\s|$)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: `${copy.rename} Chambre nord`, exact: true })).toBeFocused();

    await page.getByRole("button", { name: `${copy.actions} Chambre nord`, exact: true }).click();
    await expect(page.getByRole("button", { name: copy.up, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: copy.down, exact: true })).toBeEnabled();
    await persist(page, "save", () => page.getByRole("button", { name: copy.up, exact: true }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Chambre nord", "Séjour", "Bureau"]);
    await expect(page.getByTestId("quote-line")).toContainText(["Tablette murale", "Habillage mural en chêne", "Pose des panneaux"]);

    await page.getByRole("button", { name: `${copy.actions} Séjour`, exact: true }).click();
    await persist(page, "save", () => page.getByRole("button", { name: copy.duplicate, exact: true }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Chambre nord", "Séjour", "Séjour copie", "Bureau"]);
    await expect(page.locator(".qp-quote-section").filter({ has: page.locator("h3").filter({ hasText: "Séjour copie" }) }).getByTestId("quote-line"))
      .toContainText(["Habillage mural en chêne", "Pose des panneaux"]);
    await page.reload();
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Chambre nord", "Séjour", "Séjour copie", "Bureau"]);
    await persist(page, "undo", () => page.getByRole("button", { name: copy.undo }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Chambre nord", "Séjour", "Bureau"]);
  });

  test(`removing a section ungroups its lines; deleting requires confirmation in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    await page.getByRole("button", { name: `${copy.actions} Chambre`, exact: true }).click();
    await persist(page, "save", () => page.getByRole("button", { name: copy.remove, exact: true }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Bureau"]);
    await expect(page.locator(".qp-paper > [data-testid=quote-line]")).toContainText(["Tablette murale"]);
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
    await page.reload();
    await expect(page.locator(".qp-paper > [data-testid=quote-line]")).toContainText(["Tablette murale"]);
    await persist(page, "undo", () => page.getByRole("button", { name: copy.undo }).click());
    await expect(page.locator(".qp-quote-section").filter({ has: page.locator("h3").filter({ hasText: "Chambre" }) }).getByTestId("quote-line"))
      .toContainText(["Tablette murale"]);

    await page.getByRole("button", { name: `${copy.actions} Chambre`, exact: true }).click();
    await page.getByRole("button", { name: copy.delete, exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("Chambre");
    await expect(confirmation.getByRole("button", { name: copy.keep, exact: true })).toBeFocused();
    await confirmation.getByRole("button", { name: copy.keep, exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(page.getByText("Tablette murale", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: `${copy.actions} Chambre`, exact: true }).click();
    await page.getByRole("button", { name: copy.delete, exact: true }).click();
    await persist(page, "save", () => confirmation.getByRole("button", { name: copy.delete, exact: true }).click());
    await expect(page.getByText("Tablette murale", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("quote-line")).toHaveCount(2);
    await page.reload();
    await expect(page.getByText("Tablette murale", { exact: true })).toHaveCount(0);
  });

  test(`section insertion and contextual line membership in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    await page.getByRole("button", { name: `${copy.addAfter} Séjour`, exact: true }).click();
    await page.getByRole("textbox", { name: copy.newSectionName, exact: true }).fill("Entrée");
    await persist(page, "save", () => page.getByRole("button", { name: copy.add, exact: true }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Entrée", "Chambre", "Bureau"]);
    await page.getByRole("button", { name: copy.addEnd, exact: true }).click();
    await page.getByRole("textbox", { name: copy.newSectionName, exact: true }).fill("Atelier");
    await persist(page, "save", () => page.getByRole("button", { name: copy.add, exact: true }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Entrée", "Chambre", "Bureau", "Atelier"]);

    await page.getByRole("button", { name: `${copy.addLine} Chambre`, exact: true }).click();
    const editor = page.getByRole("dialog", { name: copy.lineDialog, exact: true });
    await expect(editor.getByLabel("Section", { exact: true })).toHaveValue("section-bedroom");
    await editor.getByLabel("Description", { exact: true }).fill("Finitions de chambre");
    await persist(page, "save", () => editor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.locator(".qp-quote-section").filter({ has: page.locator("h3").filter({ hasText: "Chambre" }) }).getByTestId("quote-line"))
      .toContainText(["Tablette murale", "Finitions de chambre"]);

    await page.getByRole("button", { name: copy.addUngrouped, exact: true }).click();
    await expect(editor.getByLabel("Section", { exact: true })).toHaveValue("");
    await editor.getByLabel("Description", { exact: true }).fill("Protection du chantier");
    await persist(page, "save", () => editor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.locator(".qp-paper > [data-testid=quote-line]")).toContainText(["Protection du chantier"]);

    await page.getByRole("button", { name: `${copy.editLine} 5`, exact: true }).click();
    await editor.getByLabel("Section", { exact: true }).selectOption({ label: copy.noSection });
    await persist(page, "save", () => editor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.locator(".qp-paper > [data-testid=quote-line]")).toContainText(["Protection du chantier", "Finitions de chambre"]);
    await page.reload();
    await expect(page.locator(".qp-paper > [data-testid=quote-line]")).toContainText(["Protection du chantier", "Finitions de chambre"]);
  });

  test(`removing every section leaves lines and no navigation rail in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    for (const section of ["Séjour", "Chambre", "Bureau"]) {
      await page.getByRole("button", { name: `${copy.actions} ${section}`, exact: true }).click();
      await persist(page, "save", () => page.getByRole("button", { name: copy.remove, exact: true }).click());
    }
    await expect(page.locator(".qp-quote-section")).toHaveCount(0);
    await expect(page.locator("#qp-review-outline")).toBeHidden();
    await expect(page.locator(".qp-paper > [data-testid=quote-line]")).toContainText([
      "Habillage mural en chêne", "Pose des panneaux", "Tablette murale",
    ]);
    await expect(page.getByRole("button", { name: copy.addEmpty, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.addLineEmpty, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("#qp-review-outline")).toBeHidden();
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
  });
}

test('section editing remains available in the narrow Quote preview', async ({ artisan }) => {
  const seeded = await createSectionedQuote(artisan);
  const { page } = artisan;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/quotes?id=${seeded.id}`);
  await page.getByRole('button', { name: 'Quote', exact: true }).click();
  await page.getByRole('button', { name: 'Rename section Séjour' }).click();
  await expect(page.getByRole('textbox', { name: 'Section name Séjour' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Section actions Séjour' }).click();
  await expect(page.getByRole('button', { name: 'Duplicate section and lines' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add section after Séjour' }).click();
  await expect(page.getByRole('textbox', { name: 'New section name' })).toBeFocused();
});
