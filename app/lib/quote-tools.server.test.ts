import { describe, expect, it } from "vitest";

import { emptyQuote } from "./quote";
import { createQuoteTools } from "./quote-tools.server";

const tool = (executor: ReturnType<typeof createQuoteTools>, name: string) => executor.tools.find((entry) => entry.name === name)!;

function citation(fields: string[], text: string, source = "current") {
  return { fields, source, text };
}

describe("createQuoteTools", () => {
  it("registers the approved commercial tools and keeps structural tools", () => {
    const executor = createQuoteTools({ quote: emptyQuote("Q-1"), capturedLineIds: [], artisanText: "" });
    expect(executor.tools.map((entry) => entry.name)).toEqual([
      "edit_quote_details", "edit_quote_lines", "create_quote_section", "rename_quote_section",
      "move_quote_line", "duplicate_quote_line", "duplicate_quote_section",
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

  it("retains the old structural tools", async () => {
    const quote = { ...emptyQuote("Q-sections"), sections: [{ id: "living", title: "Séjour" }] };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Ajoute une section Bureau." });
    await tool(executor, "create_quote_section").execute("section", { title: "Bureau" });
    expect(executor.result().quote?.sections).toHaveLength(2);
  });
});
