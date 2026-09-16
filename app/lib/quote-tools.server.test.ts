import { describe, expect, it } from "vitest";

import { createQuoteTools } from "./quote-tools.server";
import { emptyQuote } from "./quote";

describe("createQuoteTools", () => {
  it("exposes only the targeted tools and reads a cloned flat-work snapshot", async () => {
    const quote = {
      ...emptyQuote("Q-1"),
      title: "Do not expose or change me",
      lines: [{
        id: "manual-line",
        sectionId: "",
        description: "Existing manual work",
        mode: "fixed" as const,
        quantity: "",
        unit: "",
        unitPrice: "",
        amount: "0.00",
      }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "" });

    expect(executor.tools.map((tool) => tool.name)).toEqual([
      "read_work",
      "set_customer_info",
      "add_quote_line",
      "supply_missing_line_fields",
      "update_quote_line",
      "create_quote_section",
      "rename_quote_section",
      "move_quote_line",
      "duplicate_quote_line",
      "duplicate_quote_section",
    ]);

    const read = executor.tools[0]!;
    const response = await read.execute("call-1", {});

    expect(response.details).toEqual({
      sections: [],
      lines: [{
        number: 1,
        id: "manual-line",
        sectionId: "",
        description: "Existing manual work",
        mode: "fixed",
        quantity: "",
        unit: "",
        unitPrice: "",
        amount: "0.00",
        canSupplyMissingFields: false,
      }],
    });
    expect(executor.result()).toEqual({ quote, changed: [], capturedLineIds: [] });
  });

  it("copies only Artisan-provided Customer details into this Quote", async () => {
    const quote = emptyQuote("Q-customer");
    const executor = createQuoteTools({
      quote,
      capturedLineIds: [],
      artisanText: "Pour Simon Rowell, chemin des Glycines 14, 1007 Lausanne, tél. 079 123 45 67.",
    });
    const customer = executor.tools.find((tool) => tool.name === "set_customer_info")!;

    await customer.execute("customer-1", {
      name: "Simon Rowell",
      address: "chemin des Glycines 14, 1007 Lausanne",
      contact: "079 123 45 67",
    });

    expect(executor.result()).toMatchObject({
      changed: [],
      changedFields: ["customer"],
      quote: { customerName: "Simon Rowell", customerAddress: "chemin des Glycines 14, 1007 Lausanne", customerContact: "079 123 45 67" },
    });
    expect(quote.customerName).toBe("");
  });

  it("uses Google-compatible string enum schemas", () => {
    const tools = createQuoteTools({ quote: emptyQuote("Q-enum"), capturedLineIds: [], artisanText: "" }).tools;
    const add = tools.find((tool) => tool.name === "add_quote_line")!;

    expect((add.parameters as { properties: { mode: { enum: string[] }; evidence: { items: { properties: { field: { enum: string[] } } } } } }).properties.mode.enum)
      .toEqual(["quantity", "fixed"]);
    expect((add.parameters as { properties: { evidence: { items: { properties: { field: { enum: string[] } } } } } }).properties.evidence.items.properties.field.enum)
      .toEqual(["quantity", "unitPrice", "amount"]);
  });

  it("adds a flat captured Quote Line with an application UUID and numeric evidence", async () => {
    const quote = emptyQuote("Q-2");
    const executor = createQuoteTools({
      quote,
      capturedLineIds: [],
      artisanText: "Pose de la porte, forfait CHF 120.00.",
    });
    const add = executor.tools.find((tool) => tool.name === "add_quote_line")!;

    await add.execute("call-2", {
      description: "Pose de porte",
      mode: "fixed",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: "120.00",
      evidence: [{ field: "amount", text: "120.00" }],
    });

    const result = executor.result();
    expect(result.changed).toHaveLength(1);
    expect(result.capturedLineIds).toEqual(result.changed);
    expect(result.changed[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.quote?.lines).toEqual([{
      id: result.changed[0],
      sectionId: "",
      description: "Pose de porte",
      mode: "fixed",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: "120.00",
    }]);
    expect(quote.lines).toEqual([]);
  });

  it("supplies only empty fields on trusted captured lines and preserves an explicit zero", async () => {
    const quote = {
      ...emptyQuote("Q-3"),
      lines: [
        { id: "manual", sectionId: "", description: "Manual line", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "" },
        { id: "captured", sectionId: "", description: "Pose", mode: "quantity" as const, quantity: "", unit: "h", unitPrice: "0.00", amount: "" },
      ],
    };
    const executor = createQuoteTools({
      quote,
      capturedLineIds: ["captured"],
      artisanText: "La pose dure 2 heures.",
    });
    const supply = executor.tools.find((tool) => tool.name === "supply_missing_line_fields")!;

    await supply.execute("call-3", {
      lineId: "captured",
      fields: { quantity: "2.000" },
      evidence: [{ field: "quantity", text: "2" }],
    });

    expect(executor.result()).toMatchObject({
      changed: ["captured"],
      capturedLineIds: ["captured"],
      quote: { lines: [
        { id: "manual", amount: "" },
        { id: "captured", quantity: "2.000", unit: "h", unitPrice: "0.00" },
      ] },
    });
  });

  it("corrects populated and manually created lines only with explicit numeric evidence", async () => {
    const quote = {
      ...emptyQuote("Q-correction"),
      lines: [
        { id: "manual", sectionId: "", description: "Habillage mural", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
      ],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Passe la description à Habillage mural en chêne et le prix unitaire à 45 CHF par m²." });
    const update = executor.tools.find((tool) => tool.name === "update_quote_line")!;

    await update.execute("correction", {
      lineId: "manual",
      fields: { description: "Habillage mural en chêne", unitPrice: "45.00" },
      evidence: [{ field: "unitPrice", text: "45" }],
    });
    expect(executor.result()).toMatchObject({
      changed: ["manual"],
      quote: { lines: [{ id: "manual", description: "Habillage mural en chêne", quantity: "12", unitPrice: "45.00" }] },
    });

    const rejected = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Corrige cette ligne." });
    await expect(rejected.tools.find((tool) => tool.name === "update_quote_line")!.execute("missing-evidence", {
      lineId: "manual", fields: { unitPrice: "45.00" }, evidence: [],
    })).rejects.toThrow("Tool input rejected.");

    const cleared = createQuoteTools({ quote, capturedLineIds: [], artisanText: "La surface est inconnue." });
    await cleared.tools.find((tool) => tool.name === "update_quote_line")!.execute("clear", {
      lineId: "manual", fields: { quantity: "" }, clearFields: ["quantity"], evidence: [],
    });
    expect(cleared.result().quote?.lines[0].quantity).toBe("");
    const unmarked = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Corrige cette ligne." });
    await expect(unmarked.tools.find((tool) => tool.name === "update_quote_line")!.execute("clear-without-intent", {
      lineId: "manual", fields: { quantity: "" }, evidence: [],
    })).rejects.toThrow("Tool input rejected.");
    const explicitlyModelled = createQuoteTools({ quote, capturedLineIds: [], artisanText: "La demande est structurée par l'assistant." });
    await explicitlyModelled.tools.find((tool) => tool.name === "update_quote_line")!.execute("clear-with-typed-intent", {
      lineId: "manual", fields: { unitPrice: "" }, clearFields: ["unitPrice"], evidence: [],
    });
    expect(explicitlyModelled.result().quote?.lines[0].unitPrice).toBe("");
  });

  it("creates, renames, groups and moves work through stable application IDs", async () => {
    const quote = {
      ...emptyQuote("Q-sections"),
      sections: [{ id: "living", title: "Séjour" }, { id: "office", title: "Bureau" }],
      lines: [{ id: "line-1", sectionId: "living", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Ajoute la finition à 25 CHF." });
    const create = executor.tools.find((tool) => tool.name === "create_quote_section")!;
    const rename = executor.tools.find((tool) => tool.name === "rename_quote_section")!;
    const add = executor.tools.find((tool) => tool.name === "add_quote_line")!;
    const move = executor.tools.find((tool) => tool.name === "move_quote_line")!;

    await create.execute("create", { title: "Finition" });
    const createdSection = executor.result().quote!.sections[2];
    await rename.execute("rename", { sectionId: "office", title: "Bureau principal" });
    await add.execute("add", { description: "Finition", mode: "fixed", amount: "25.00", sectionId: createdSection.id, evidence: [{ field: "amount", text: "25" }] });
    await move.execute("move", { lineId: "line-1", sectionId: "" });

    expect(executor.result()).toMatchObject({
      changed: [expect.any(String), "line-1"],
      changedFields: [`section:${createdSection.id}`, "section:office"],
      quote: { sections: [{ id: "living", title: "Séjour" }, { id: "office", title: "Bureau principal" }, { id: createdSection.id, title: "Finition" }] },
    });
    const lines = executor.result().quote!.lines;
    expect(lines[0]).toMatchObject({ id: "line-1", sectionId: "" });
    expect(lines[1]).toMatchObject({ sectionId: createdSection.id, description: "Finition" });
  });

  it("duplicates lines and sections with fresh IDs and clears unknown measurements", async () => {
    const quote = {
      ...emptyQuote("Q-copy"),
      sections: [{ id: "bedroom", title: "Chambre" }],
      lines: [
        { id: "cladding", sectionId: "bedroom", description: "Habillage mural de 12 m² en chêne", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "tablet", sectionId: "bedroom", description: "Pose de tablette", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "150.00" },
      ],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Copie la Chambre au Bureau; la surface est inconnue." });
    const duplicateSection = executor.tools.find((tool) => tool.name === "duplicate_quote_section")!;
    await duplicateSection.execute("section-copy", { sectionId: "bedroom", measurementPolicy: "unknown" });

    const result = executor.result();
    expect(result.quote?.sections).toEqual([{ id: "bedroom", title: "Chambre" }, { id: expect.stringMatching(/^section-/), title: "Chambre copie" }]);
    const copies = result.quote!.lines.slice(2);
    expect(copies).toHaveLength(2);
    expect(copies[0]).toMatchObject({ sectionId: result.quote!.sections[1].id, quantity: "", unit: "m²", unitPrice: "40.00", amount: "" });
    expect(copies[0].description).not.toContain("12 m²");

    const words = createQuoteTools({
      quote: { ...quote, lines: [{ ...quote.lines[0], description: "Pose sur 12 mètres carrés, dimensions 30/60 mm" }] },
      capturedLineIds: [], artisanText: "Copie avec surface inconnue.",
    });
    await words.tools.find((tool) => tool.name === "duplicate_quote_line")!.execute("words-copy", { lineId: "cladding", measurementPolicy: "unknown" });
    expect(words.result().quote?.lines[1].description).not.toMatch(/12 mètres carrés|30\/60 mm/);
    const mass = createQuoteTools({
      quote: { ...quote, lines: [{ ...quote.lines[0], description: "Peinture de 12 litres et 5 kilogrammes" }] },
      capturedLineIds: [], artisanText: "Copie avec quantité inconnue.",
    });
    await mass.tools.find((tool) => tool.name === "duplicate_quote_line")!.execute("mass-copy", { lineId: "cladding", measurementPolicy: "unknown" });
    expect(mass.result().quote?.lines[1].description).not.toMatch(/12 litres|5 kilogrammes/);
    expect(copies[1]).toMatchObject({ sectionId: result.quote!.sections[1].id, amount: "150.00" });
    expect(new Set(result.changed)).toEqual(new Set(copies.map((line) => line.id)));

    const lineCopy = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Copie cette ligne." });
    const duplicateLine = lineCopy.tools.find((tool) => tool.name === "duplicate_quote_line")!;
    await duplicateLine.execute("line-copy", { lineId: "tablet" });
    expect(lineCopy.result().quote?.lines).toHaveLength(3);
    expect(lineCopy.result().quote?.lines[2]).toMatchObject({ id: expect.not.stringMatching("tablet"), amount: "150.00", sectionId: "bedroom" });
  });

  it("accepts trusted Artisan history and an exact original line value as evidence", async () => {
    const quote = {
      ...emptyQuote("Q-history"),
      lines: [
        { id: "source", sectionId: "", description: "Prix déjà fourni", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "75.00" },
        { id: "captured", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "" },
      ],
    };
    const fromHistory = createQuoteTools({
      quote,
      capturedLineIds: ["captured"],
      artisanText: "Ajoute le prix indiqué plus tôt.",
      artisanHistory: ["Le prix est de 75 CHF."],
    });
    const supplyFromHistory = fromHistory.tools.find((tool) => tool.name === "supply_missing_line_fields")!;

    await supplyFromHistory.execute("call-history", {
      lineId: "captured",
      fields: { amount: "75.00" },
      evidence: [{ field: "amount", text: "75" }],
    });
    expect(fromHistory.result().quote?.lines[1]?.amount).toBe("75.00");

    const fromOriginal = createQuoteTools({ quote, capturedLineIds: ["captured"], artisanText: "Ajoute le prix indiqué plus tôt." });
    const supplyFromOriginal = fromOriginal.tools.find((tool) => tool.name === "supply_missing_line_fields")!;
    await supplyFromOriginal.execute("call-original", {
      lineId: "captured",
      fields: { amount: "75.00" },
      evidence: [{ field: "amount", text: "75", sourceLineId: "source" }],
    });
    expect(fromOriginal.result().quote?.lines[1]?.amount).toBe("75.00");
  });

  it("does not use a fabricated evidence sentence to change an original numeric value", async () => {
    const quote = { ...emptyQuote("Q-evidence"), lines: [{ id: "source", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "75.00" }] };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Nouveau travail, prix à confirmer." });
    await expect(executor.tools[1].execute("fabricated", {
      description: "Finition", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "900.00",
      evidence: [{ field: "amount", text: "75 devient 900", sourceLineId: "source" }],
    })).rejects.toThrow("Tool input rejected.");
  });

  it("validates typed commercial values after the model has interpreted its source evidence", async () => {
    for (const text of ["RAL-5", "-5 CHF", "-12.5 CHF", "15 CHF", "5'000 CHF"]) {
      const executor = createQuoteTools({ quote: emptyQuote(`Q-${text}`), capturedLineIds: [], artisanText: text });
      const add = executor.tools.find((tool) => tool.name === "add_quote_line")!;

      await expect(add.execute("call-invalid-value", {
        description: "Forfait",
        mode: "fixed",
        quantity: "",
        unit: "",
        unitPrice: "",
        amount: "-5.00",
        evidence: [{ field: "amount", text }],
      })).rejects.toThrow("Tool input rejected.");
      expect(executor.result()).toEqual({ quote: null, changed: [], capturedLineIds: [] });
    }
  });

  it("poisons preflight validation failures and refuses a derived quantity-line amount", async () => {
    const preflight = createQuoteTools({ quote: emptyQuote("Q-preflight"), capturedLineIds: [], artisanText: "5 CHF" });
    const add = preflight.tools.find((tool) => tool.name === "add_quote_line")!;
    expect(() => add.prepareArguments?.({ unexpected: true })).toThrow("Tool input rejected.");
    expect(preflight.result()).toEqual({ quote: null, changed: [], capturedLineIds: [] });

    const quote = {
      ...emptyQuote("Q-derived"),
      lines: [{ id: "captured", sectionId: "", description: "Pose", mode: "quantity" as const, quantity: "2", unit: "h", unitPrice: "", amount: "" }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: ["captured"], artisanText: "Le montant est 10 CHF." });
    const supply = executor.tools.find((tool) => tool.name === "supply_missing_line_fields")!;

    await expect(supply.execute("call-derived", {
      lineId: "captured",
      fields: { amount: "10.00" },
      evidence: [{ field: "amount", text: "10" }],
    })).rejects.toThrow("Tool input rejected.");
    expect(executor.result()).toEqual({ quote: null, changed: [], capturedLineIds: [] });
  });

  it("rejects a manual line as a follow-up target and discards the staged snapshot", async () => {
    const quote = {
      ...emptyQuote("Q-4"),
      lines: [{ id: "manual", sectionId: "", description: "Manual line", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "" }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Forfait de 10 CHF." });
    const supply = executor.tools.find((tool) => tool.name === "supply_missing_line_fields")!;

    await expect(supply.execute("call-4", {
      lineId: "manual",
      fields: { amount: "10.00" },
      evidence: [{ field: "amount", text: "10" }],
    })).rejects.toThrow("Tool input rejected.");

    expect(executor.result()).toEqual({ quote: null, changed: [], capturedLineIds: [] });
  });

  it("poisons the staged result after an unknown business or draft argument", async () => {
    const quote = {
      ...emptyQuote("Q-5"),
      lines: [{ id: "manual", sectionId: "", description: "Manual line", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "" }],
    };
    const executor = createQuoteTools({ quote, capturedLineIds: [], artisanText: "Forfait de 10.00 CHF." });
    const add = executor.tools.find((tool) => tool.name === "add_quote_line")!;

    await add.execute("call-5a", {
      description: "Forfait",
      mode: "fixed",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: "10.00",
      evidence: [{ field: "amount", text: "10.00" }],
    });
    await expect(add.execute("call-5b", {
      description: "Forfait",
      mode: "fixed",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: "10.00",
      evidence: [{ field: "amount", text: "10.00" }],
      businessId: "other-business",
    } as never)).rejects.toThrow("Tool input rejected.");

    expect(executor.result()).toEqual({ quote: null, changed: [], capturedLineIds: [] });
  });
});
