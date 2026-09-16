import { createSectionedQuote, expect, setInterfaceLanguage, test } from "./fixtures";

async function saveAction(page: import("@playwright/test").Page, action: "save" | "undo", trigger: () => Promise<unknown>) {
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/quotes" &&
    candidate.request().method() === "POST" &&
    candidate.request().postDataJSON()?.action === action);
  await trigger();
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole("status")).toContainText(/Saved|Enregistré/);
}

for (const locale of ["en", "fr"] as const) {
  const copy = locale === "en"
    ? { organize: "Organise sections", done: "Done", keep: "Keep section", delete: "Delete section and its lines", apply: "Apply", edit: "Edit line", duplicate: "Duplicate line", up: "Move up line", down: "Move down line", sectionName: "Section name", noSection: "No section", undo: /^Undo/ }
    : { organize: "Organiser les sections", done: "Terminer", keep: "Conserver la section", delete: "Supprimer la section et ses lignes", apply: "Appliquer", edit: "Modifier la ligne", duplicate: "Dupliquer la ligne", up: "Monter la ligne", down: "Descendre la ligne", sectionName: "Nom de section", noSection: "Sans section", undo: /^Annuler/ };

  test(`section transactions, movement, duplication and undo survive in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    const openSections = page.getByRole("button", { name: copy.organize, exact: true }).first();
    await openSections.click();
    const editor = page.getByRole("dialog", { name: locale === "en" ? "Organise sections" : "Organiser les sections", exact: true });
    const chamberName = editor.getByLabel(`${copy.sectionName} 2`, { exact: true });
    await chamberName.focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(editor.getByLabel(`${copy.sectionName} 1`, { exact: true })).toBeFocused();
    await editor.getByLabel(`${copy.sectionName} 1`, { exact: true }).fill("Chambre nord");
    await editor.getByRole("button", { name: locale === "en" ? /Duplicate section Séjour/ : /Dupliquer la section Séjour/ }).click();
    await saveAction(page, "save", () => editor.getByRole("button", { name: copy.done, exact: true }).click());

    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Chambre nord", "Séjour", "Séjour copie", "Bureau"]);
    await page.reload();
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Chambre nord", "Séjour", "Séjour copie", "Bureau"]);

    await saveAction(page, "undo", () => page.getByRole("button", { name: copy.undo }).click());
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Chambre", "Bureau"]);
    await page.reload();
    await expect(page.locator(".qp-quote-section h3")).toHaveText(["Séjour", "Chambre", "Bureau"]);

    await page.getByRole("button", { name: copy.organize, exact: true }).first().click();
    const deleteEditor = page.getByRole("dialog", { name: locale === "en" ? "Organise sections" : "Organiser les sections", exact: true });
    await deleteEditor.getByRole("button", { name: /Supprimer la section et ses lignes Chambre|Delete section and its lines Chambre/ }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText(/Chambre/);
    await expect(confirmation.getByRole("button", { name: copy.keep, exact: true })).toBeFocused();
    await confirmation.getByRole("button", { name: copy.keep, exact: true }).click();
    await expect(confirmation).toBeHidden();

    await deleteEditor.getByRole("button", { name: /Supprimer la section et ses lignes Chambre|Delete section and its lines Chambre/ }).click();
    await confirmation.getByRole("button", { name: copy.delete, exact: true }).click();
    await expect(deleteEditor.getByLabel(`${copy.sectionName} 2`, { exact: true })).toBeFocused();
    await saveAction(page, "save", () => deleteEditor.getByRole("button", { name: copy.done, exact: true }).click());
    await expect(page.getByText("Tablette murale", { exact: true })).toBeHidden();
    await page.reload();
    await expect(page.getByText("Tablette murale", { exact: true })).toBeHidden();

    await page.getByRole("button", { name: locale === "en" ? "Organise" : "Organiser", exact: true }).click();
    const finalEditor = page.getByRole("dialog", { name: locale === "en" ? "Organise sections" : "Organiser les sections", exact: true });
    const deleteSection = locale === "en" ? /Delete section and its lines Séjour/ : /Supprimer la section et ses lignes Séjour/;
    await finalEditor.getByRole("button", { name: deleteSection }).click();
    await confirmation.getByRole("button", { name: copy.delete, exact: true }).click();
    await expect(finalEditor.getByLabel(`${copy.sectionName} 1`, { exact: true })).toBeFocused();
    const deleteLastSection = locale === "en" ? /Delete section and its lines Bureau/ : /Supprimer la section et ses lignes Bureau/;
    await finalEditor.getByRole("button", { name: deleteLastSection }).click();
    await confirmation.getByRole("button", { name: copy.delete, exact: true }).click();
    await expect(finalEditor.getByRole("button", { name: locale === "en" ? "Add" : "Ajouter", exact: true })).toBeFocused();
    await saveAction(page, "save", () => finalEditor.getByRole("button", { name: copy.done, exact: true }).click());
    await expect(page.locator("#qp-review-outline")).toBeHidden();
    await expect(page.locator("#quote-section-opener")).toBeFocused();
  });

  test(`line grouping and deliberate copies use the section boundary in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    await expect(page.getByRole("button", { name: `${copy.down} 2`, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: `${copy.up} 3`, exact: true })).toBeDisabled();
    await saveAction(page, "save", () => page.getByRole("button", { name: `${copy.down} 1`, exact: true }).click());
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Pose des panneaux", "Habillage mural en chêne", "Tablette murale"]);

    await page.getByRole("button", { name: `${copy.edit} 1`, exact: true }).click();
    const lineEditor = page.getByRole("dialog", { name: locale === "en" ? "Edit quote line" : "Modifier la ligne", exact: true });
    await lineEditor.getByLabel("Section", { exact: true }).selectOption({ label: "Bureau" });
    await saveAction(page, "save", () => lineEditor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.getByRole("button", { name: `${copy.edit} 3`, exact: true })).toBeFocused();
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Habillage mural en chêne", "Tablette murale", "Pose des panneaux"]);

    await page.getByRole("button", { name: `${copy.edit} 2`, exact: true }).click();
    await lineEditor.getByLabel("Section", { exact: true }).selectOption({ label: "Bureau" });
    await saveAction(page, "save", () => lineEditor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Habillage mural en chêne", "Pose des panneaux", "Tablette murale"]);

    await page.getByRole("button", { name: `${copy.edit} 3`, exact: true }).click();
    await lineEditor.getByLabel("Section", { exact: true }).selectOption({ label: copy.noSection });
    await saveAction(page, "save", () => lineEditor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.getByRole("button", { name: `${copy.edit} 1`, exact: true })).toBeFocused();
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Tablette murale", "Habillage mural en chêne", "Pose des panneaux"]);

    await saveAction(page, "save", () => page.getByRole("button", { name: `${copy.duplicate} 1`, exact: true }).click());
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Tablette murale", "Tablette murale", "Habillage mural en chêne", "Pose des panneaux"]);
    await page.reload();
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Tablette murale", "Tablette murale", "Habillage mural en chêne", "Pose des panneaux"]);
    await saveAction(page, "undo", () => page.getByRole("button", { name: copy.undo }).click());
    await expect(page.locator("[data-testid=quote-line]")).toContainText(["Tablette murale", "Habillage mural en chêne", "Pose des panneaux"]);
  });
}
