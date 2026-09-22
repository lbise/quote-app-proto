import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Context } from "@earendil-works/pi-ai";

import proposedTools from "../../docs/assistant-contract/proposed-tools.json";
import { editQuoteLinesDescription } from "../../docs/assistant-contract/edit-quote-lines";
import { calculateQuote, emptyQuote } from "./quote";
import { generateQuoteChange, type QuoteAIModelBoundary } from "./quote-assistant.server";

function modelBoundary(responses: ReturnType<typeof fauxAssistantMessage>[]) {
  const fake = fauxProvider();
  fake.setResponses(responses);
  const models = createModels();
  models.setProvider(fake.provider);
  const contexts: Context[] = [];
  const boundary: QuoteAIModelBoundary = {
    model: fake.getModel(), timeoutMs: 1000,
    streamFn: (model, context, options) => {
      contexts.push(JSON.parse(JSON.stringify(context)));
      return models.streamSimple(model, context, options);
    },
  };
  return { boundary, contexts, fake };
}

const input = () => ({ quote: emptyQuote("Q-1"), capturedLineIds: [], messages: [], text: "Paint the walls. Measurements and prices are unknown.", locale: "en" as const });
const lineEvidence = (fields: string[], text: string, source = "current") => ({ fields, source, text });

describe("pi Quote assistant model boundary", () => {
  it("advertises only the approved commercial and structural tools", async () => {
    const { boundary, contexts } = modelBoundary([fauxAssistantMessage([fauxText("What room should I paint?")])]);
    await generateQuoteChange(input(), boundary);
    expect(contexts[0].tools?.map((tool) => tool.name)).toEqual([
      "edit_quote_details", "edit_quote_lines", "edit_quote_sections", "copy_quote_work", "move_quote_work", "delete_quote_lines",
    ]);
  });

  it("gives the fake provider bedroom evidence instructions and matching section and line schemas", async () => {
    const text = "Create a Bedroom section. Bedroom: paint 12 m² at CHF 35 per m².";
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_sections", {
          sections: [{ title: "Chambre" }],
          evidence: [lineEvidence(["/sections/0/title"], "Bedroom")],
        }),
        fauxToolCall("edit_quote_lines", {
          lines: [{ description: "Peinture de la chambre", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "35", amount: "" }],
          evidence: [lineEvidence([
            "/lines/0/mode", "/lines/0/description", "/lines/0/quantity", "/lines/0/unit", "/lines/0/unitPrice",
          ], "Bedroom: paint 12 m² at CHF 35 per m².")],
        }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The bedroom work was added.")]),
    ]);

    const result = await generateQuoteChange({ ...input(), text }, boundary);

    expect(result.quote).toMatchObject({
      sections: [{ title: "Chambre" }],
      lines: [{ description: "Peinture de la chambre", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "35", amount: "" }],
    });
    expect(contexts[0].systemPrompt).toContain("The application validates numeric evidence and performs calculations.");
    expect(contexts[0].systemPrompt).not.toContain("Evidence is a grouped array");
    const lineTool = contexts[0].tools?.find((tool) => tool.name === "edit_quote_lines");
    const sectionTool = contexts[0].tools?.find((tool) => tool.name === "edit_quote_sections");
    const copyTool = contexts[0].tools?.find((tool) => tool.name === "copy_quote_work");
    expect(lineTool?.description).toBe(editQuoteLinesDescription);
    expect(lineTool?.description).toBe(proposedTools.find((tool) => tool.name === "edit_quote_lines")?.description);
    expect(lineTool?.parameters).toMatchObject({
      properties: {
        lines: { items: { properties: { description: { type: "string" }, mode: {}, quantity: {}, unit: {}, unitPrice: {}, amount: {} } } },
        evidence: { items: { properties: { fields: {}, source: {}, text: {} } } },
      },
    });
    expect(sectionTool?.parameters).toMatchObject({
      properties: {
        sections: { items: { properties: { title: { type: "string" } } } },
        evidence: { items: { properties: { fields: {}, source: {}, text: {} } } },
      },
    });
    expect(JSON.stringify(copyTool?.parameters)).toContain("Cite the supplied section title with /source/title when copying a section.");
  });

  it("explains message source IDs and accepts a grouped citation after the observed section-citation mistakes", async () => {
    const text = "On a les zones A à G. Fais le détail par zone, dans cet ordre.";
    const sections = ["A", "B", "C", "D", "E", "F", "G"].map(zone => ({ title: `Zone ${zone}` }));
    const fields = sections.map((_, index) => `/sections/${index}/title`);
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
        sections, evidence: [lineEvidence(fields, text, "currentMessage")],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
        sections, evidence: [lineEvidence([fields[0]], "Bardage et menuiserie", "current")],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
        sections, evidence: [lineEvidence(fields, text, "current")],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Les sept zones sont ajoutées."),
    ]);
    const result = await generateQuoteChange({ ...input(), text, locale: "fr", quote: { ...emptyQuote("Q-citations"), title: "Bardage et menuiserie" } }, boundary);
    expect(result.quote?.sections.map(section => section.title)).toEqual(["Zone A", "Zone B", "Zone C", "Zone D", "Zone E", "Zone F", "Zone G"]);
    expect(result.quote?.lines).toEqual([]);
    expect(result.debug).toMatchObject({ outcome: "committed_with_failed_calls", failedCalls: 2, attempts: [
      { outcome: "failed", errorCode: "unknown_evidence_source" },
      { outcome: "failed", errorCode: "evidence_not_found" },
      { outcome: "applied" },
    ] });
    for (const name of ["edit_quote_details", "edit_quote_lines", "edit_quote_sections", "copy_quote_work"]) {
      const tool = contexts[0].tools?.find(tool => tool.name === name);
      expect(tool?.parameters).toMatchObject({ properties: { evidence: { items: { properties: {
        source: { description: expect.stringContaining('Use "current" for currentMessage.text') },
        text: { description: expect.stringContaining("not from the Quote title") },
      } } } } });
    }
    const sectionTool = contexts[0].tools?.find(tool => tool.name === "edit_quote_sections");
    expect(sectionTool?.description).toContain('"fields":["/sections/0/title","/sections/1/title"]');
    expect(sectionTool?.description).toBe(proposedTools.find(tool => tool.name === "edit_quote_sections")?.description);
  });

  it("returns missing mode and unit paths to the model and accepts the repaired painting call", async () => {
    const text = "Je veux repeindre la chambre d'eugènie en vert pomme. Chambre de 2x4m sur 3m de plafond. Prix au m2 12.50chf";
    const args = {
      lines: [{ sectionId: "painting", description: "Peinture vert pomme de la chambre d'Eugénie", mode: "quantity", quantity: "36", unit: "m2", unitPrice: "12.50", amount: "" }],
      evidence: [lineEvidence(["/lines/0/description", "/lines/0/quantity", "/lines/0/unitPrice"], text)],
    };
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", args)], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        ...args,
        evidence: [...args.evidence, lineEvidence(["/lines/0/mode", "/lines/0/unit"], "Prix au m2 12.50chf")],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Les travaux de peinture ont été ajoutés.")]),
    ]);
    const result = await generateQuoteChange({
      ...input(), text, locale: "fr",
      quote: { ...emptyQuote("Q-bedroom"), sections: [{ id: "painting", title: "Travaux de peinture" }] },
    }, boundary);
    const rejection = contexts[1].messages.find((message) => message.role === "toolResult" && message.isError);
    expect(JSON.stringify(rejection)).toContain("Missing evidence fields: /lines/0/mode, /lines/0/unit");
    expect(result.quote?.lines).toEqual([expect.objectContaining({ sectionId: "painting", quantity: "36", unit: "m2", unitPrice: "12.50" })]);
    expect(result.debug).toMatchObject({ failedCalls: 1, outcome: "committed_with_failed_calls" });
  });

  it("uses fixed mode for a forfait and applies the worked evidence example after an amount-mode rejection", async () => {
    const text = "Inspect 3 smoke alarms.\n\nInspection costs 19 per alarm.\n\nThe travel forfait is 47.";
    const workedExample = {
      lines: [
        { description: "Contrôle de détecteurs de fumée", mode: "quantity", quantity: "3", unit: "pièce", unitPrice: "19", amount: "" },
        { description: "Déplacement", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "47" },
      ],
      evidence: [
        lineEvidence(["/lines/0/description", "/lines/0/quantity"], "Inspect 3 smoke alarms."),
        lineEvidence(["/lines/0/mode", "/lines/0/unit", "/lines/0/unitPrice"], "Inspection costs 19 per alarm."),
        lineEvidence(["/lines/1/description", "/lines/1/mode", "/lines/1/amount"], "The travel forfait is 47."),
      ],
    };
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Déplacement", mode: "amount", quantity: "", unit: "", unitPrice: "", amount: "47" }],
        evidence: [lineEvidence(["/lines/0/description", "/lines/0/mode", "/lines/0/amount"], "The travel forfait is 47.")],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", workedExample)], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The inspection and travel were added.")]),
    ]);

    const result = await generateQuoteChange({ ...input(), text, quote: { ...emptyQuote("Q-1"), vatRegistered: false } }, boundary);
    const lineTool = contexts[0].tools?.find((tool) => tool.name === "edit_quote_lines");

    expect(lineTool?.description).toBe(editQuoteLinesDescription);
    expect(lineTool?.description).toBe(proposedTools.find((tool) => tool.name === "edit_quote_lines")?.description);
    expect(lineTool?.description).toContain("Write new Quote Line descriptions in French, even for an English interface.");
    expect(lineTool?.description).toContain('Use mode "fixed" for a forfait');
    expect(lineTool?.description).toContain('"amount" is a field, never a mode');
    expect(lineTool?.description).toContain('Use mode "quantity" for per-unit pricing.');
    expect(lineTool?.description).toContain("exact contiguous excerpt");
    expect(lineTool?.description).toContain(text);
    expect(lineTool?.description).toContain(JSON.stringify(workedExample));
    expect(lineTool?.parameters).toMatchObject({ properties: { lines: { items: { properties: { mode: {
      description: 'Use "fixed" for a forfait or one stated total; amount is a field, never a mode. Use "quantity" for per-unit pricing; leave an unknown quantity or unit price as an empty string.',
    } } } } } });
    expect(JSON.stringify(lineTool?.parameters)).toContain('"fixed"');
    expect(result.quote?.lines).toEqual([
      expect.objectContaining({ description: "Contrôle de détecteurs de fumée", mode: "quantity", quantity: "3", unit: "pièce", unitPrice: "19", amount: "" }),
      expect.objectContaining({ description: "Déplacement", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "47" }),
    ]);
    expect(calculateQuote(result.quote)).toMatchObject({ subtotal: 10_400, total: 10_400 });
    expect(result.debug).toMatchObject({ failedCalls: 1, outcome: "committed_with_failed_calls" });
  });

  it("creates a line from Artisan facts and preserves an explicit zero", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Pose de porte", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "0.00" }],
        evidence: [lineEvidence(["/lines/0/mode", "/lines/0/description", "/lines/0/amount"], "Pose de porte gratuite à 0 CHF")],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The free door installation was added.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), text: "Pose de porte gratuite à 0 CHF." }, boundary);
    expect(result.quote?.lines[0]).toMatchObject({ description: "Pose de porte", amount: "0.00" });
    expect(result.changed).toHaveLength(1);
  });

  it("edits details and a manually entered line without capture restrictions", async () => {
    const quote = {
      ...emptyQuote("Q-edit"), title: "Ancien titre", customerName: "Ancien client",
      lines: [{ id: "manual", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_details", { fields: { title: "Nouveau titre", customerName: "Simon" }, evidence: [
          { fields: ["title", "customerName"], source: "current", text: "Nouveau titre et Simon" },
        ] }),
        fauxToolCall("edit_quote_lines", { lines: [{ id: "manual", description: "Installation", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "125.00" }], evidence: [
          lineEvidence(["/lines/0/description", "/lines/0/amount"], "Installation à 125 CHF"),
        ] }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The details and existing line were corrected.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), quote, text: "Nouveau titre et Simon. Installation à 125 CHF.", locale: "fr" }, boundary);
    expect(result.quote).toMatchObject({ title: "Nouveau titre", customerName: "Simon", lines: [{ id: "manual", amount: "125.00" }] });
    expect(result.changed).toEqual(["manual"]);
    expect(result.changedFields).toEqual(["title", "customerName"]);
  });

  it("applies bounded structural moves and targeted deletion without evidence", async () => {
    const quote = {
      ...emptyQuote("Q-structure"),
      sections: [{ id: "living", title: "Séjour" }],
      lines: [
        { id: "one", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "10.00" },
        { id: "two", sectionId: "living", description: "Finition", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "20.00" },
      ],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("move_quote_work", { move: { lineIds: ["one"], destinationSectionId: "living", beforeLineId: "two" } }),
        fauxToolCall("delete_quote_lines", { lineIds: ["one"] }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The work was reorganized and the selected line was removed.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), quote, text: "Move the pose into Séjour, then remove it.", locale: "en" }, boundary);
    expect(result.quote?.lines).toEqual([expect.objectContaining({ id: "two", sectionId: "living" })]);
    expect(result.changed).toEqual(["one"]);
  });

  it("discards mixed staged edits when deletion would remove all original work", async () => {
    const quote = {
      ...emptyQuote("Q-destructive"),
      lines: [
        { id: "one", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "10.00" },
        { id: "two", sectionId: "", description: "Finition", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "20.00" },
      ],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_details", { fields: { title: "Should not persist" }, evidence: [{ fields: ["title"], source: "current", text: "Should not persist" }] }),
        fauxToolCall("delete_quote_lines", { lineIds: ["one", "two"] }),
      ], { stopReason: "toolUse" }),
    ]);
    await expect(generateQuoteChange({ ...input(), quote, text: "Delete all work.", locale: "en" }, boundary)).rejects.toMatchObject({ diagnostic: { code: "destructive_scope_rejected", outcome: "discarded" } });
  });

  it("allows model-derived prices when their source facts are cited", async () => {
    const quote = {
      ...emptyQuote("Q-derived"),
      lines: [{ id: "wall", sectionId: "", description: "Peinture", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" }],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ id: "wall", description: "Peinture", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "42.00", amount: "" }],
        evidence: [
          lineEvidence(["/lines/0/unitPrice"], "40.00", "line:wall.unitPrice"),
          lineEvidence(["/lines/0/unitPrice"], "5 pour cent"),
        ],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The adjusted price was applied.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), quote, text: "Augmente le prix de 5 pour cent.", locale: "fr" }, boundary);
    expect(result.quote?.lines[0].unitPrice).toBe("42.00");
  });

  it("rejects raw arguments and reports an actionable failed call", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", { lines: [{ description: "Pose", mode: "fixed", quantity: 2, unit: "", unitPrice: "", amount: "" }] })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("I will retry with the correct shape.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), text: "Add the pose." }, boundary);
    expect(result.debug).toMatchObject({ failedCalls: 1, outcome: "unchanged_with_failed_calls", attempts: [{ name: "edit_quote_lines", outcome: "failed" }] });
    expect(result.message).toContain("Some tool calls failed");
  });

  it("keeps successful staged work after one failed call", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_lines", { lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "10.00" }], evidence: [lineEvidence(["/lines/0/mode", "/lines/0/description", "/lines/0/amount"], "Pose pour 10 CHF.")] }),
        fauxToolCall("edit_quote_details", { fields: { title: "Titre" } }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The supplied line was added.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), text: "Pose pour 10 CHF." }, boundary);
    expect(result.quote?.lines).toHaveLength(1);
    expect(result.quote?.title).toBe("");
    expect(result.debug).toMatchObject({ failedCalls: 1, outcome: "committed_with_failed_calls" });
  });

  it("rejects oversized drafts before inference", async () => {
    const { boundary, fake } = modelBoundary([fauxAssistantMessage([fauxText("This must not be sent.")])]);
    const work = { ...input(), quote: { ...input().quote, title: "界".repeat(110_000) } };
    await expect(generateQuoteChange(work, boundary)).rejects.toMatchObject({ diagnostic: { code: "draft_context_too_large", notSent: true } });
    expect(fake.getPendingResponseCount()).toBe(1);
  });

  it("rejects a provider payload over 600 KB before sending it", async () => {
    const { boundary, fake } = modelBoundary([fauxAssistantMessage([fauxText("This must not be sent.")])]);
    const oversizedPayload: QuoteAIModelBoundary = {
      ...boundary,
      streamFn: (model, context, options) => {
        options?.onPayload?.({ padding: "x".repeat(600_001) }, model);
        return boundary.streamFn(model, context, options);
      },
    };
    await expect(generateQuoteChange(input(), oversizedPayload)).rejects.toMatchObject({ diagnostic: { code: "provider_payload_limit_exceeded" } });
    expect(fake.getPendingResponseCount()).toBe(1);
  });
});
