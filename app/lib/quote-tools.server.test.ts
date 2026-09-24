import { describe, expect, it } from "vitest";

import { emptyQuote } from "./quote";
import { createQuoteTools } from "./quote-tools.server";

const tool = (executor: ReturnType<typeof createQuoteTools>, name: string) => executor.tools.find((entry) => entry.name === name)!;

function executor(quote = emptyQuote("Q-1")) {
  return createQuoteTools({ quote, capturedLineIds: [] });
}

describe("createQuoteTools", () => {
  it("registers evidence-free schemas and rejects legacy evidence arguments", async () => {
    const tools = executor();
    expect(tools.tools.map((entry) => entry.name)).toEqual([
      "edit_quote_details", "edit_quote_lines", "edit_quote_sections", "copy_quote_work", "move_quote_work", "delete_quote_lines",
    ]);
    for (const registered of tools.tools) {
      expect(JSON.stringify(registered.parameters)).not.toContain("evidence");
    }
    await expect(tool(tools, "edit_quote_details").execute("legacy-details", {
      fields: { title: "Cuisine" }, evidence: [],
    })).rejects.toThrow("invalid_tool_arguments");
    await expect(tool(tools, "edit_quote_lines").execute("legacy-lines", {
      lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "10" }], evidence: [],
    })).rejects.toThrow("invalid_tool_arguments");
    await expect(tool(tools, "edit_quote_sections").execute("legacy-sections", {
      sections: [{ title: "Cuisine" }], evidence: [],
    })).rejects.toThrow("invalid_tool_arguments");
    await expect(tool(tools, "copy_quote_work").execute("legacy-copy", {
      source: { lineIds: ["missing"] }, measurementPolicy: "retain", evidence: [],
    })).rejects.toThrow("invalid_tool_arguments");
    await expect(tool(tools, "move_quote_work").execute("legacy-move", {
      move: { lineIds: ["missing"], destinationSectionId: "" }, evidence: [],
    })).rejects.toThrow("invalid_tool_arguments");
    await expect(tool(tools, "delete_quote_lines").execute("legacy-delete", {
      lineIds: ["missing"], evidence: [],
    })).rejects.toThrow("invalid_tool_arguments");
  });

  it("edits Quote details, including copied identity, VAT and discount fields", async () => {
    const tools = executor(emptyQuote("Q-details"));
    await tool(tools, "edit_quote_details").execute("details", {
      fields: {
        title: "Projet cuisine", siteAddress: "rue des Lilas 4", customerName: "Simon",
        vatRegistered: true, vatId: "CHE-123", discountMode: "percent", discount: "5",
      },
    });
    expect(tools.result()).toMatchObject({
      changed: [],
      changedFields: ["title", "siteAddress", "customerName", "vatId", "discount", "vatRegistered", "discountMode"],
      quote: { title: "Projet cuisine", siteAddress: "rue des Lilas 4", customerName: "Simon", vatRegistered: true, vatId: "CHE-123", discountMode: "percent", discount: "5" },
    });
  });

  it("allows deliberate clears, canonicalizes discount modes, and blocks a published reference change", async () => {
    const tools = executor({ ...emptyQuote("Q-clear"), title: "Ancien titre", discountMode: "percent", discount: "5" });
    await tool(tools, "edit_quote_details").execute("clear", { fields: { title: "", discount: "" } });
    expect(tools.result().quote).toMatchObject({ title: "", discount: "" });

    const switched = executor({ ...emptyQuote("Q-discount"), discountMode: "percent", discount: "5" });
    await tool(switched, "edit_quote_details").execute("none", { fields: { discountMode: "none", discount: "0,00" } });
    expect(switched.result().quote).toMatchObject({ discountMode: "none", discount: "0" });

    const locked = createQuoteTools({ quote: emptyQuote("Q-locked"), capturedLineIds: [], referenceLocked: true });
    await expect(tool(locked, "edit_quote_details").execute("locked", { fields: { reference: "Q-new" } })).rejects.toThrow("reference_locked");
  });

  it("creates and edits complete lines in one bounded batch", async () => {
    const tools = executor({
      ...emptyQuote("Q-lines"),
      lines: [{ id: "manual", sectionId: "", description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    });
    await tool(tools, "edit_quote_lines").execute("batch", {
      lines: [
        { id: "manual", description: "Installation", mode: "quantity", quantity: "5", unit: "h", unitPrice: "45.00", amount: "" },
        { description: "Dépose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
      ],
    });
    const result = tools.result();
    expect(result.changed).toEqual(["manual", expect.any(String)]);
    expect(result.quote?.lines).toEqual([
      { id: "manual", sectionId: "", description: "Installation", mode: "quantity", quantity: "5", unit: "h", unitPrice: "45.00", amount: "" },
      { id: result.changed[1], sectionId: "", description: "Dépose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
    ]);
  });

  it("accepts model-derived values without recalculating them", async () => {
    const tools = executor({
      ...emptyQuote("Q-derived"),
      lines: [{ id: "wall", sectionId: "", description: "Peinture des murs", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" }],
    });
    await tool(tools, "edit_quote_lines").execute("adjust", {
      lines: [{ id: "wall", description: "Peinture des murs", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "42.00", amount: "" }],
    });
    expect(tools.result().quote?.lines[0].unitPrice).toBe("42.00");
  });

  it("rejects an invalid batch without partially mutating staged work", async () => {
    const tools = executor({
      ...emptyQuote("Q-atomic"),
      lines: [{ id: "one", sectionId: "", description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "10.00" }],
    });
    await expect(tool(tools, "edit_quote_lines").execute("invalid", {
      lines: [
        { id: "one", description: "Pose corrigée", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "20.00" },
        { id: "missing", description: "Inconnue", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "30.00" },
      ],
    })).rejects.toThrow("invalid_line_id");
    expect(tools.result().quote?.lines[0].amount).toBe("10.00");
    expect(tools.result().changed).toEqual([]);
  });

  it("creates and renames sections in one atomic batch", async () => {
    const tools = executor({ ...emptyQuote("Q-sections"), sections: [{ id: "living", title: "Séjour" }] });
    await tool(tools, "edit_quote_sections").execute("sections", {
      sections: [{ id: "living", title: "Salon" }, { title: "Bureau" }, { title: "Cuisine" }],
    });
    expect(tools.result().quote?.sections).toEqual([
      { id: "living", title: "Salon" },
      { id: expect.any(String), title: "Bureau" },
      { id: expect.any(String), title: "Cuisine" },
    ]);
    await expect(tool(tools, "edit_quote_sections").execute("invalid", {
      sections: [{ id: "living", title: "Changed" }, { id: "living", title: "Again" }],
    })).rejects.toThrow("invalid_section_id");
    expect(tools.result().quote?.sections[0].title).toBe("Salon");
  });

  it("rejects invented section IDs without staging work, then accepts new sections without IDs", async () => {
    const tools = executor(emptyQuote("Q-new-sections"));
    await expect(tool(tools, "edit_quote_sections").execute("invented", {
      sections: [{ id: "zone_a", title: "Atelier" }, { id: "zone_b", title: "Réserve" }],
    })).rejects.toThrow("invalid_section_id");
    expect(tools.result().quote?.sections).toEqual([]);
    await tool(tools, "edit_quote_sections").execute("created", {
      sections: [{ title: "Atelier" }, { title: "Réserve" }],
    });
    expect(tools.result().quote?.sections).toEqual([
      { id: expect.any(String), title: "Atelier" },
      { id: expect.any(String), title: "Réserve" },
    ]);
  });

  it("copies lines and sections with fresh IDs and unknown measurements", async () => {
    const tools = executor({
      ...emptyQuote("Q-copy"), sections: [{ id: "living", title: "Séjour" }],
      lines: [
        { id: "wall", sectionId: "living", description: "Peinture 12 m²", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "fixed", sectionId: "living", description: "Forfait tablette\navec fixations", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "150.00" },
      ],
    });
    await tool(tools, "copy_quote_work").execute("line-copy", { source: { lineIds: ["wall", "fixed"] }, measurementPolicy: "unknown" });
    const copied = tools.result();
    const copiedIds = copied.copyMappings!.map((mapping) => mapping.newId);
    expect(copied.quote?.lines.filter((line) => copiedIds.includes(line.id))).toEqual([
      expect.objectContaining({ sectionId: "living", description: "Peinture", quantity: "", amount: "" }),
      expect.objectContaining({ sectionId: "living", description: "Forfait tablette\navec fixations", amount: "150.00" }),
    ]);
    await tool(tools, "copy_quote_work").execute("section-copy", {
      source: { sectionId: "living", title: "Cuisine" }, measurementPolicy: "retain",
    });
    expect(tools.result().quote?.sections.map((section) => section.title)).toEqual(["Séjour", "Cuisine"]);

    const ambiguous = executor({
      ...emptyQuote("Q-ambiguous"),
      lines: [{ id: "ambiguous", sectionId: "", description: "Pose 12 toises", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "10.00", amount: "" }],
    });
    await expect(tool(ambiguous, "copy_quote_work").execute("ambiguous", { source: { lineIds: ["ambiguous"] }, measurementPolicy: "unknown" })).rejects.toThrow("ambiguous_measurement");
  });

  it("moves selected lines and sections while preserving IDs and order", async () => {
    const tools = executor({
      ...emptyQuote("Q-move"), sections: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
      lines: [
        { id: "one", sectionId: "a", description: "One", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "1" },
        { id: "two", sectionId: "a", description: "Two", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "2" },
        { id: "four", sectionId: "a", description: "Four", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "4" },
        { id: "three", sectionId: "b", description: "Three", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "3" },
      ],
    });
    await tool(tools, "move_quote_work").execute("lines", { move: { lineIds: ["two", "one"], destinationSectionId: "b", beforeLineId: "three" } });
    expect(tools.result().quote?.lines.map((line) => `${line.id}:${line.sectionId}`)).toEqual(["four:a", "two:b", "one:b", "three:b"]);
    await tool(tools, "move_quote_work").execute("sections", { move: { sectionIds: ["b"], beforeSectionId: "a" } });
    expect(tools.result().quote?.sections.map((section) => section.id)).toEqual(["b", "a"]);
  });

  it("preserves structural limits and deletion rollback", async () => {
    const lines = Array.from({ length: 51 }, (_, index) => ({ id: `line-${index}`, sectionId: "section", description: `Line ${index}`, mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1" }));
    const limited = executor({ ...emptyQuote("Q-copy-limit"), sections: [{ id: "section", title: "Section" }], lines });
    await expect(tool(limited, "copy_quote_work").execute("copy-limit", {
      source: { sectionId: "section", title: "Copy" }, measurementPolicy: "retain",
    })).rejects.toThrow("bulk_limit_exceeded");
    expect(limited.result().quote?.sections).toHaveLength(1);

    const deleting = executor({
      ...emptyQuote("Q-delete"),
      lines: [
        { id: "one", sectionId: "", description: "One", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "1" },
        { id: "two", sectionId: "", description: "Two", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "2" },
      ],
    });
    await tool(deleting, "delete_quote_lines").execute("delete-one", { lineIds: ["one"] });
    await expect(tool(deleting, "delete_quote_lines").execute("delete-last", { lineIds: ["two"] })).rejects.toThrow("destructive_scope_rejected");
    expect(deleting.result().quote?.lines.map((line) => line.id)).toEqual(["two"]);
  });
});
