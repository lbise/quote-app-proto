import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Context } from "@earendil-works/pi-ai";

import { emptyQuote } from "./quote";
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
