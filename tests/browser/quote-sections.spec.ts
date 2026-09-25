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

async function expectSectionTitles(page: Page, titles: string[]) {
  const headings = page.locator(".qp-quote-section").getByRole("heading", { level: 3 });
  await expect(headings).toHaveCount(titles.length);
  for (const [index, title] of titles.entries()) {
    // The pencil and creation controls must not change the section's accessible name.
    await expect(headings.nth(index)).toHaveAccessibleName(title);
  }
}

const translations = {
  en: {
    rename: "Rename section", name: "Section name", actions: "Section actions",
    save: "Save", cancel: "Cancel", up: "Move section up", down: "Move section down",
    duplicate: "Duplicate section and lines", remove: "Remove section (keep lines)",
    delete: "Delete section and its lines", keep: "Keep section",
    insert: "Insert section below", addSection: "Add section", addToQuote: "Add to Quote",
    addLine: "Add line to", lineLabel: "Line", addUngrouped: "Add ungrouped line", addLineEmpty: "Add a line",
    quote: "Quote", publish: "Review & publish", confirm: "Confirm publication", published: "Published revision 1",
    editLine: "Edit line", lineDialog: /^(?:Add a line|Edit quote line \d+)$/, apply: "Apply",
    noSection: "No section", newSectionName: "New section name", add: "Add", undo: /^Undo/,
  },
  fr: {
    rename: "Renommer la section", name: "Nom de section", actions: "Actions de section",
    save: "Enregistrer", cancel: "Annuler", up: "Monter la section", down: "Descendre la section",
    duplicate: "Dupliquer la section et ses lignes", remove: "Retirer la section (garder les lignes)",
    delete: "Supprimer la section et ses lignes", keep: "Conserver la section",
    insert: "Insérer une section après celle-ci", addSection: "Ajouter une section", addToQuote: "Ajouter au devis",
    addLine: "Ajouter une ligne à", lineLabel: "Ligne", addUngrouped: "Ajouter une ligne sans section", addLineEmpty: "Ajouter une ligne",
    quote: "Devis", publish: "Relire et publier", confirm: "Confirmer la publication", published: "Révision publiée 1",
    editLine: "Modifier la ligne", lineDialog: /^(?:Ajouter une ligne|Modifier la ligne \d+)$/, apply: "Appliquer",
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
    await expect(page.getByRole("button", { name: /^(Organise sections|Organiser les sections|Add a section)$/ })).toHaveCount(0);
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
    await expectSectionTitles(page, ["Séjour", "Chambre", "Bureau"]);

    await rename.click();
    await page.getByRole("textbox", { name: `${copy.name} Chambre`, exact: true }).fill("Chambre nord");
    await persist(page, "save", () => page.getByRole("button", { name: copy.save, exact: true }).click());
    await expectSectionTitles(page, ["Séjour", "Chambre nord", "Bureau"]);
    await expect(rail.getByRole("button", { name: /^Chambre nord(?:\s|$)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: `${copy.rename} Chambre nord`, exact: true })).toBeFocused();

    await page.getByRole("button", { name: `${copy.actions} Chambre nord`, exact: true }).click();
    await expect(page.getByRole("button", { name: copy.up, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: copy.down, exact: true })).toBeEnabled();
    await persist(page, "save", () => page.getByRole("button", { name: copy.up, exact: true }).click());
    await expectSectionTitles(page, ["Chambre nord", "Séjour", "Bureau"]);
    await expect(page.getByTestId("quote-line")).toContainText(["Tablette murale", "Habillage mural en chêne", "Pose des panneaux"]);

    await page.getByRole("button", { name: `${copy.actions} Séjour`, exact: true }).click();
    await persist(page, "save", () => page.getByRole("button", { name: copy.duplicate, exact: true }).click());
    await expectSectionTitles(page, ["Chambre nord", "Séjour", "Séjour copie", "Bureau"]);
    await expect(page.locator(".qp-quote-section").filter({ has: page.locator("h3").filter({ hasText: "Séjour copie" }) }).getByTestId("quote-line"))
      .toContainText(["Habillage mural en chêne", "Pose des panneaux"]);
    await page.reload();
    await expectSectionTitles(page, ["Chambre nord", "Séjour", "Séjour copie", "Bureau"]);
    await persist(page, "undo", () => page.getByRole("button", { name: copy.undo }).click());
    await expectSectionTitles(page, ["Chambre nord", "Séjour", "Bureau"]);
  });

  test(`removing a section ungroups its lines; deleting requires confirmation in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.goto(`/quotes?id=${seeded.id}`);

    await page.getByRole("button", { name: `${copy.actions} Chambre`, exact: true }).click();
    await persist(page, "save", () => page.getByRole("button", { name: copy.remove, exact: true }).click());
    await expectSectionTitles(page, ["Séjour", "Bureau"]);
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

    const sections = page.locator(".qp-quote-section");
    const endAdd = page.getByRole("button", { name: copy.addSection, exact: true });
    await expect(endAdd).toHaveCount(1);
    await expect(endAdd).toHaveText(copy.addSection);
    expect(await endAdd.evaluate(button => {
      const sections = document.querySelectorAll(".qp-quote-section");
      return Boolean(sections[sections.length - 1].compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect(sections.getByRole("button", { name: copy.addSection, exact: true })).toHaveCount(0);
    await expect(page.locator(".qp-section-add-line")).toHaveCount(0);
    for (const title of ["Séjour", "Chambre", "Bureau"]) {
      const section = sections.filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      const addLine = section.getByRole("button", { name: `${copy.addLine} ${title}`, exact: true });
      await expect(addLine).toHaveCount(1);
      await expect(addLine).toHaveText(copy.lineLabel);
      await expect(addLine.locator("svg")).toBeVisible();
      await expect(section.locator(".qp-section-title").getByRole("button", { name: `${copy.addLine} ${title}`, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: copy.insert, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: `${copy.actions} Séjour`, exact: true }).click();
    await page.getByRole("button", { name: copy.insert, exact: true }).click();
    const newSection = page.getByRole("textbox", { name: copy.newSectionName, exact: true });
    await expect(newSection).toBeFocused();
    // Insertion is inline after Séjour, not in a dialog or at the document end.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await newSection.evaluate(input => {
      const sections = document.querySelectorAll(".qp-quote-section");
      const subtotal = sections[0].querySelector(".qp-section-subtotal")!;
      return Boolean(subtotal.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(input.compareDocumentPosition(sections[1]) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await newSection.fill("Entrée");
    await persist(page, "save", () => page.getByRole("button", { name: copy.add, exact: true }).click());
    await expectSectionTitles(page, ["Séjour", "Entrée", "Chambre", "Bureau"]);
    await endAdd.click();
    await page.getByRole("textbox", { name: copy.newSectionName, exact: true }).fill("Atelier");
    await persist(page, "save", () => page.getByRole("button", { name: copy.add, exact: true }).click());
    await expectSectionTitles(page, ["Séjour", "Entrée", "Chambre", "Bureau", "Atelier"]);

    await page.getByRole("button", { name: `${copy.addLine} Chambre`, exact: true }).click();
    const editor = page.getByRole("dialog", { name: copy.lineDialog, exact: true });
    await expect(editor.getByLabel("Section", { exact: true })).toHaveValue("section-bedroom");
    await editor.getByLabel("Description", { exact: true }).fill("Finitions de chambre");
    await persist(page, "save", () => editor.getByRole("button", { name: copy.apply, exact: true }).click());
    await expect(page.locator(".qp-quote-section").filter({ has: page.locator("h3").filter({ hasText: "Chambre" }) }).getByTestId("quote-line"))
      .toContainText(["Tablette murale", "Finitions de chambre"]);

    await page.getByRole("button", { name: copy.addToQuote, exact: true }).click();
    await page.getByRole("menuitem", { name: copy.addUngrouped, exact: true }).click();
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
    await expectSectionTitles(page, ["Séjour", "Entrée", "Chambre", "Bureau", "Atelier"]);
    await expect(endAdd).toHaveCount(1);
    await expect(page.locator(".qp-section-add-line")).toHaveCount(0);

    await page.getByRole("button", { name: copy.addToQuote, exact: true }).click();
    await page.getByRole("menuitem", { name: copy.addSection, exact: true }).click();
    await expect(newSection).toBeFocused();
    await newSection.fill("Grenier");
    await persist(page, "save", () => page.getByRole("button", { name: copy.add, exact: true }).click());
    await expectSectionTitles(page, ["Séjour", "Entrée", "Chambre", "Bureau", "Atelier", "Grenier"]);
    await page.reload();
    await expectSectionTitles(page, ["Séjour", "Entrée", "Chambre", "Bureau", "Atelier", "Grenier"]);
    await expect(endAdd).toHaveCount(1);
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
    await expect(page.getByRole("button", { name: copy.addSection, exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: copy.addSection, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.addLineEmpty, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator("#qp-review-outline")).toBeHidden();
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
  });

  test(`mobile creation menus cancel without mutation and published sections are read-only in ${locale}`, async ({ artisan }) => {
    const seeded = await createSectionedQuote(artisan);
    const { page } = artisan;
    await setInterfaceLanguage(page, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/quotes?id=${seeded.id}`);
    await page.getByRole("radio", { name: copy.quote, exact: true }).click();
    let saves = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/quotes" && request.method() === "POST" && request.postDataJSON()?.action === "save") saves += 1;
    });
    const rename = page.getByRole("button", { name: `${copy.rename} Séjour`, exact: true });
    await expect(rename.locator(".qp-edit-affordance")).toHaveText("");
    await expect(rename.locator(".qp-edit-affordance svg")).toBeVisible();
    await expect(rename.locator(".qp-edit-affordance")).toHaveCSS("opacity", "1");
    const lineEdit = page.getByRole("button", { name: `${copy.editLine} 1`, exact: true });
    await expect(lineEdit).toHaveText("");
    await expect(lineEdit.locator("svg")).toBeVisible();
    await expect(page.locator(".qp-paper").getByText(/^(Edit|Modifier)$/)).toHaveCount(0);
    await rename.click();
    await expect(page.getByRole("textbox", { name: `${copy.name} Séjour`, exact: true })).toBeFocused();
    await page.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(rename).toBeFocused();

    const actions = page.getByRole("button", { name: `${copy.actions} Séjour`, exact: true });
    const newSection = page.getByRole("textbox", { name: copy.newSectionName, exact: true });
    for (const cancelWith of ["Escape", "button"]) {
      await actions.click();
      await expect(page.getByRole("button", { name: copy.duplicate, exact: true })).toBeVisible();
      await page.getByRole("button", { name: copy.insert, exact: true }).click();
      await expect(newSection).toBeFocused();
      await newSection.fill("Discard this section");
      if (cancelWith === "Escape") await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: copy.cancel, exact: true }).click();
      await expect(newSection).toHaveCount(0);
      await expect(actions).toBeFocused();
      await expectSectionTitles(page, ["Séjour", "Chambre", "Bureau"]);
    }

    const addToQuote = page.getByRole("button", { name: copy.addToQuote, exact: true });
    await addToQuote.click();
    await expect(page.getByRole("menuitem", { name: copy.addSection, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(addToQuote).toBeFocused();
    await addToQuote.click();
    await page.getByRole("menuitem", { name: copy.addUngrouped, exact: true }).click();
    const editor = page.getByRole("dialog", { name: copy.lineDialog });
    await expect(editor.getByLabel("Section", { exact: true })).toHaveValue("");
    await editor.getByLabel("Description", { exact: true }).fill("Discard this line");
    await editor.getByRole("button", { name: copy.cancel, exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(addToQuote).toBeFocused();
    await addToQuote.click();
    await page.getByRole("menuitem", { name: copy.addSection, exact: true }).click();
    await expect(newSection).toBeFocused();
    await newSection.fill("Also discarded");
    await page.keyboard.press("Escape");
    await expect(newSection).toHaveCount(0);
    await expect(addToQuote).toBeFocused();
    await expectSectionTitles(page, ["Séjour", "Chambre", "Bureau"]);
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
    expect(saves).toBe(0);

    await page.getByRole("button", { name: copy.publish, exact: true }).click();
    await page.getByRole("button", { name: copy.confirm, exact: true }).click();
    await expect(page.getByText(copy.published, { exact: true })).toBeVisible();
    for (const name of [copy.addToQuote, copy.addSection, copy.addLineEmpty, copy.insert]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    for (const prefix of [copy.rename, copy.actions, copy.addLine, copy.editLine]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${prefix} `) })).toHaveCount(0);
    }
    await expect(page.locator(".qp-edit-target, .qp-edit-affordance")).toHaveCount(0);
    await expectSectionTitles(page, ["Séjour", "Chambre", "Bureau"]);
    await expect(page.getByTestId("quote-line")).toHaveCount(3);
    await page.reload();
    await page.getByRole("radio", { name: copy.quote, exact: true }).click();
    await expect(page.getByRole("button", { name: copy.addToQuote, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.addSection, exact: true })).toHaveCount(0);
    await expectSectionTitles(page, ["Séjour", "Chambre", "Bureau"]);
  });
}
