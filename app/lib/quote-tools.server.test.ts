import { describe, expect, it } from "vitest";

import { emptyQuote } from "./quote";
import { createQuoteTools } from "./quote-tools.server";

const tool = (executor: ReturnType<typeof createQuoteTools>, name: string) => executor.tools.find((entry) => entry.name === name)!;

function citation(fields: string[], text: string, source = "current") {
  return { fields, source, text };
}

describe("createQuoteTools", () => {
  it("registers the approved commercial and structural tools", () => {
    const executor = createQuoteTools({ quote: emptyQuote("Q-1"), capturedLineIds: [], artisanText: "" });
    expect(executor.tools.map((entry) => entry.name)).toEqual([
      "edit_quote_details", "edit_quote_lines", "edit_quote_sections", "copy_quote_work", "move_quote_work", "delete_quote_lines",
    ]);
  });

  it("edits Quote details, including copied identity, VAT and discount fields", async () => {
    const executor = createQuoteTools({
      quote: emptyQuote("Q-details"),
      capturedLineIds: [],
      artisanText: "Projet cuisine, rue des Lilas 4, Simon, TVA oui CHE-123, remise 5 pour cent.",
    });
    await tool(executor, "edit_quote_details").execute("details", {
      fields: {
        title: "Projet cuisine", siteAddress: "rue des Lilas 4", customerName: "Simon",
        vatRegistered: true, vatId: "CHE-123", discountMode: "percent", discount: "5",
      },
      evidence: [
        citation(["title", "siteAddress", "customerName"], "Projet cuisine, rue des Lilas 4, Simon"),
        citation(["vatRegistered", "vatId", "discountMode", "discount"], "TVA oui CHE-123, remise 5 pour cent"),
      ],
    });
    expect(executor.result()).toMatchObject({
      changed: [],
      changedFields: ["title", "siteAddress", "customerName", "vatId", "discount", "vatRegistered", "discountMode"],
      quote: { title: "Projet cuisine", siteAddress: "rue des Lilas 4", customerName: "Simon", vatRegistered: true, vatId: "CHE-123", discountMode: "percent", discount: "5" },
    });
  });

  it("allows deliberate clears, canonicalizes discount modes, and blocks a published reference change", async () => {
    const executor = createQuoteTools({
      quote: { ...emptyQuote("Q-clear"), title: "Ancien titre", discountMode: "percent", discount: "5" },
      capturedLineIds: [], artisanText: "Efface le titre et la remise.",
    });
    await tool(executor, "edit_quote_details").execute("clear", { fields: { title: "", discount: "" } });
    expect(executor.result().quote).toMatchObject({ title: "", discount: "" });

    const unchangedDiscount = createQuoteTools({ quote: { ...emptyQuote("Q-discount-unchanged"), title: "Ancien titre" }, capturedLineIds: [], artisanText: "Corrige uniquement le titre." });
    await tool(unchangedDiscount, "edit_quote_details").execute("title-only", {
      fields: { title: "Nouveau titre" }, evidence: [citation(["title"], "Corrige uniquement le titre.")],
    });
    expect(unchangedDiscount.result().quote).toMatchObject({ title: "Nouveau titre", discountMode: "none", discount: "0" });
    expect(unchangedDiscount.result().changedFields).toEqual(["title"]);

    const switched = createQuoteTools({ quote: { ...emptyQuote("Q-discount"), discountMode: "percent", discount: "5" }, capturedLineIds: [], artisanText: "Supprime la remise." });
    await tool(switched, "edit_quote_details").execute("none", { fields: { discountMode: "none", discount: "0,00" }, evidence: [citation(["discountMode", "discount"], "Supprime la remise.")] });
    expect(switched.result().quote).toMatchObject({ discountMode: "none", discount: "0" });

    const locked = createQuoteTools({ quote: emptyQuote("Q-locked"), capturedLineIds: [], artisanText: "Référence Q-new." , referenceLocked: true });
    await expect(tool(locked, "edit_quote_details").execute("locked", {
      fields: { reference: "Q-new" }, evidence: [citation(["reference"], "Q-new")],
    })).rejects.toThrow("reference_locked");
  });

  it("creates and edits complete lines in one bounded batch", async () => {
    const quote = {
      ...emptyQuote("Q-lines"),
      lines: [{ id: "manual", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    };
    const executor = createQuoteTools({
      quote, capturedLineIds: [],
      artisanText: "Remplace la pose par installation, 5 heures à 45 CHF, et ajoute la dépose à 80 CHF.",
    });
    await tool(executor, "edit_quote_lines").execute("batch", {
      lines: [
        { id: "manual", description: "Installation", mode: "quantity", quantity: "5", unit: "h", unitPrice: "45.00", amount: "" },
        { description: "Dépose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
      ],
      evidence: [
        citation(["/lines/0/mode", "/lines/0/description", "/lines/0/quantity", "/lines/0/unit", "/lines/0/unitPrice"], "5 heures à 45 CHF"),
        citation(["/lines/1/mode", "/lines/1/description", "/lines/1/amount"], "dépose à 80 CHF"),
      ],
    });
    const result = executor.result();
    expect(result.changed).toEqual(["manual", expect.any(String)]);
    expect(result.quote?.lines).toEqual([
      { id: "manual", sectionId: "", description: "Installation", mode: "quantity", quantity: "5", unit: "h", unitPrice: "45.00", amount: "" },
      { id: result.changed[1], sectionId: "", description: "Dépose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
    ]);
    expect(result.capturedLineIds).toEqual([result.changed[1]]);
  });

  it("accepts model-derived values with source provenance but does not calculate them", async () => {
    const quote = {
      ...emptyQuote("Q-derived"),
      lines: [{ id: "wall", sectionId: "", description: "Peinture des murs", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Augmente le prix de 5 pour cent." });
    await tool(executor, "edit_quote_lines").execute("adjust", {
      lines: [{ id: "wall", description: "Peinture des murs", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "42.00", amount: "" }],
      evidence: [
        citation(["/lines/0/unitPrice"], "40.00", "line:wall.unitPrice"),
        citation(["/lines/0/unitPrice"], "5 pour cent"),
      ],
    });
    expect(executor.result().quote?.lines[0].unitPrice).toBe("42.00");
  });

  it("rejects an invalid batch without partially mutating staged work", async () => {
    const quote = {
      ...emptyQuote("Q-atomic"),
      lines: [{ id: "one", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "10.00" }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Corrige la pose." });
    await expect(tool(executor, "edit_quote_lines").execute("invalid", {
      lines: [
        { id: "one", description: "Pose corrigée", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "20.00" },
        { id: "missing", description: "Inconnue", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "30.00" },
      ],
      evidence: [citation(["/lines/0/description", "/lines/0/amount"], "Corrige la pose.")],
    })).rejects.toThrow("invalid_line_id");
    expect(executor.result().quote?.lines[0].amount).toBe("10.00");
    expect(executor.result().changed).toEqual([]);
  });

  it("creates and renames sections in one atomic batch", async () => {
    const quote = { ...emptyQuote("Q-sections"), sections: [{ id: "living", title: "Séjour" }] };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Bureau et Cuisine" });
    await tool(executor, "edit_quote_sections").execute("sections", {
      sections: [{ id: "living", title: "Salon" }, { title: "Bureau" }, { title: "Cuisine" }],
      evidence: [citation(["/sections/0/title", "/sections/1/title", "/sections/2/title"], "Bureau et Cuisine")],
    });
    expect(executor.result().quote?.sections).toEqual([
      { id: "living", title: "Salon" },
      { id: expect.any(String), title: "Bureau" },
      { id: expect.any(String), title: "Cuisine" },
    ]);

    await expect(tool(executor, "edit_quote_sections").execute("invalid", {
      sections: [{ id: "living", title: "Changed" }, { id: "living", title: "Again" }],
      evidence: [citation(["/sections/0/title", "/sections/1/title"], "Changed Again")],
    })).rejects.toThrow("invalid_section_id");
    expect(executor.result().quote?.sections[0].title).toBe("Salon");
  });

  it("identifies missing evidence in the bedroom painting calls so a retry can repair it", async () => {
    const text = "Je veux repeindre la chambre d'eugènie en vert pomme. Chambre de 2x4m sur 3m de plafond. Prix au m2 12.50chf";
    const executor = createQuoteTools({
      quote: emptyQuote("Q-bedroom"), capturedLineIds: [], artisanText: "Oui, les murs.",
      artisanHistorySources: [{ source: "history_1", text }],
    });
    const sections = tool(executor, "edit_quote_sections");
    const sectionArgs = { sections: [{ title: "Travaux de peinture" }] };
    expect(() => sections.prepareArguments!(sectionArgs)).toThrow("Missing evidence fields: /sections/0/title");
    await expect(sections.execute("missing-title", sectionArgs)).rejects.toThrow("Missing evidence fields: /sections/0/title");
    await sections.execute("section", {
      ...sectionArgs, evidence: [citation(["/sections/0/title"], "Je veux repeindre", "history_1")],
    });
    const sectionId = executor.result().quote!.sections[0].id;
    const lines = tool(executor, "edit_quote_lines");
    const args = {
      lines: [{ sectionId, quantity: "36", amount: "", unitPrice: "12.50", description: "Peinture vert pomme de la chambre d'Eugénie (2 x 4 m, hauteur 3 m)", unit: "m2", mode: "quantity" }],
      evidence: [
        citation(["/lines/0/quantity", "/lines/0/unitPrice"], "Chambre de 2x4m sur 3m de plafond. Prix au m2 12.50chf", "history_1"),
        citation(["/lines/0/description"], "Je veux repeindre la chambre d'eugènie en vert pomme.", "history_1"),
      ],
    };
    // The provider validates in prepareArguments; direct execution must report the same repair.
    expect(() => lines.prepareArguments!(args)).toThrow("Missing evidence fields: /lines/0/mode, /lines/0/unit");
    await expect(lines.execute("missing-mode-unit", args)).rejects.toThrow("Missing evidence fields: /lines/0/mode, /lines/0/unit");
    expect(executor.result().quote!.lines).toEqual([]);
    await lines.execute("repaired", {
      ...args,
      evidence: [...args.evidence, citation(["/lines/0/mode", "/lines/0/unit"], "Prix au m2 12.50chf", "history_1")],
    });
    expect(executor.result().quote!.lines).toEqual([expect.objectContaining({ sectionId, quantity: "36", unitPrice: "12.50" })]);
  });

  it.each([
    ["history_2", "Peinture", "unknown_evidence_source"],
    ["current", "Invented work", "evidence_not_found"],
  ])("still rejects unsupported evidence from %s", async (source, text, code) => {
    const executor = createQuoteTools({ quote: emptyQuote("Q-evidence"), capturedLineIds: [], artisanText: "Peinture" });
    await expect(tool(executor, "edit_quote_sections").execute("unsupported", {
      sections: [{ title: "Travaux de peinture" }], evidence: [citation(["/sections/0/title"], text, source)],
    })).rejects.toThrow(code);
    expect(executor.diagnostic()?.code).toBe(code);
    expect(executor.result().quote!.sections).toEqual([]);
  });

  it("copies lines and sections with fresh IDs and unknown measurements", async () => {
    const quote = {
      ...emptyQuote("Q-copy"),
      sections: [{ id: "living", title: "Séjour" }],
      lines: [
        { id: "wall", sectionId: "living", description: "Peinture 12 m²", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "fixed", sectionId: "living", description: "Forfait tablette\navec fixations", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "150.00" },
      ],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Copie le travail dans Cuisine." });
    await tool(executor, "copy_quote_work").execute("line-copy", {
      source: { lineIds: ["wall", "fixed"] }, measurementPolicy: "unknown",
    });
    const copied = executor.result();
    expect(copied.quote?.lines).toHaveLength(4);
    const copiedIds = copied.copyMappings!.map((mapping) => mapping.newId);
    expect(copied.quote?.lines.filter((line) => copiedIds.includes(line.id))).toEqual([
      expect.objectContaining({ sectionId: "living", description: "Peinture", quantity: "", amount: "" }),
      expect.objectContaining({ sectionId: "living", description: "Forfait tablette\navec fixations", amount: "150.00" }),
    ]);
    expect(copied.copyMappings).toEqual([
      { sourceId: "wall", newId: expect.any(String) },
      { sourceId: "fixed", newId: expect.any(String) },
    ]);

    await expect(tool(executor, "copy_quote_work").execute("section-copy-missing-evidence", {
      source: { sectionId: "living", title: "Cuisine" }, measurementPolicy: "retain",
    })).rejects.toThrow("missing_evidence");
    expect(executor.result().quote?.sections.map((section) => section.title)).toEqual(["Séjour"]);

    await tool(executor, "copy_quote_work").execute("section-copy", {
      source: { sectionId: "living", title: "Cuisine" }, measurementPolicy: "retain",
      evidence: [citation(["/source/title"], "Cuisine")],
    });
    expect(executor.result().quote?.sections.map((section) => section.title)).toEqual(["Séjour", "Cuisine"]);
    expect(executor.result().quote?.lines.filter((line) => line.sectionId !== "living")).toHaveLength(4);

    const ambiguous = createQuoteTools({
      quote: { ...emptyQuote("Q-ambiguous"), lines: [{ id: "ambiguous", sectionId: "", description: "Pose 12 toises", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "10.00", amount: "" }] },
      capturedLineIds: [], artisanText: "Copie avec mesure inconnue.",
    });
    await expect(tool(ambiguous, "copy_quote_work").execute("ambiguous", { source: { lineIds: ["ambiguous"] }, measurementPolicy: "unknown" })).rejects.toThrow("ambiguous_measurement");
  });

  it("moves selected lines and sections while preserving IDs and order", async () => {
    const quote = {
      ...emptyQuote("Q-move"),
      sections: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
      lines: [
        { id: "one", sectionId: "a", description: "One", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1" },
        { id: "two", sectionId: "a", description: "Two", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "2" },
        { id: "four", sectionId: "a", description: "Four", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "4" },
        { id: "three", sectionId: "b", description: "Three", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "3" },
      ],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Organise." });
    await tool(executor, "move_quote_work").execute("lines", { move: { lineIds: ["two", "one"], destinationSectionId: "b", beforeLineId: "three" } });
    expect(executor.result().quote?.lines.map((line) => `${line.id}:${line.sectionId}`)).toEqual(["four:a", "two:b", "one:b", "three:b"]);
    await tool(executor, "move_quote_work").execute("sections", { move: { sectionIds: ["b"], beforeSectionId: "a" } });
    expect(executor.result().quote?.sections.map((section) => section.id)).toEqual(["b", "a"]);
    expect(executor.result().quote?.lines.map((line) => line.id)).toEqual(["two", "one", "three", "four"]);
  });

  it("rejects oversized section copies without changing staged work", async () => {
    const lines = Array.from({ length: 51 }, (_, index) => ({ id: `line-${index}`, sectionId: "section", description: `Line ${index}`, mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1" }));
    const quote = { ...emptyQuote("Q-copy-limit"), sections: [{ id: "section", title: "Section" }], lines };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Copy this section." });
    await expect(tool(executor, "copy_quote_work").execute("copy-limit", {
      source: { sectionId: "section", title: "Copy" }, measurementPolicy: "retain",
      evidence: [citation(["/source/title"], "Copy")],
    })).rejects.toThrow("bulk_limit_exceeded");
    expect(executor.result().quote?.sections).toHaveLength(1);
    expect(executor.result().quote?.lines).toHaveLength(51);
  });

  it("deletes targeted lines but rejects cumulative removal of all original work", async () => {
    const quote = {
      ...emptyQuote("Q-delete"),
      lines: [
        { id: "one", sectionId: "", description: "One", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1" },
        { id: "two", sectionId: "", description: "Two", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "2" },
      ],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Supprime la première ligne." });
    await tool(executor, "delete_quote_lines").execute("delete-one", { lineIds: ["one"] });
    expect(executor.result().quote?.lines.map((line) => line.id)).toEqual(["two"]);
    await expect(tool(executor, "delete_quote_lines").execute("delete-last", { lineIds: ["two"] })).rejects.toThrow("destructive_scope_rejected");
    expect(executor.result().quote?.lines.map((line) => line.id)).toEqual(["two"]);
  });
});
