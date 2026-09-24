import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Context } from "@earendil-works/pi-ai";

import proposedTools from "../../docs/assistant-contract/proposed-tools.json";
import { editQuoteLinesDescription } from "../../docs/assistant-contract/edit-quote-lines";
import { calculateQuote, emptyQuote } from "./quote";
import { generateQuoteChange, resolveQuoteAIGeneration, type QuoteAIModelBoundary } from "./quote-assistant.server";

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

describe("pi Quote assistant model boundary", () => {
  it("passes explicit evaluation generation into the Agent transport", async () => {
    const { boundary, fake } = modelBoundary([fauxAssistantMessage([fauxText("No changes needed.")])]);
    const options: { maxTokens?: number; reasoning?: string }[] = [];
    const evaluationBoundary: QuoteAIModelBoundary = {
      ...boundary,
      model: { ...boundary.model, reasoning: true },
      generation: { reasoning: "high", maxOutputTokens: 1024 },
      streamFn: (model, context, streamOptions) => {
        options.push({ maxTokens: streamOptions?.maxTokens, reasoning: streamOptions?.reasoning });
        return boundary.streamFn(model, context, streamOptions);
      },
    };
    const result = await generateQuoteChange(input(), evaluationBoundary);
    expect(result.quote).toBeNull();
    expect(options).toEqual([{ maxTokens: 1024, reasoning: "high" }]);
    expect(fake.getPendingResponseCount()).toBe(0);
  });

  it("rejects off and unsupported output limits for Gemini 3.5 Flash-Lite", () => {
    const { boundary } = modelBoundary([]);
    const gemini = { ...boundary.model, provider: "google", api: "google-generative-ai", id: "gemini-3.5-flash-lite", reasoning: true, maxTokens: 65_536 };
    expect(resolveQuoteAIGeneration(gemini)).toEqual({ reasoning: "off", maxOutputTokens: 4096 }); // Production remains unchanged.
    expect(() => resolveQuoteAIGeneration(gemini, { reasoning: "off", maxOutputTokens: 1024 })).toThrow("off is not supported");
    expect(() => resolveQuoteAIGeneration(gemini, { reasoning: "minimal", maxOutputTokens: 65_537 })).toThrow("1 through 65536");
    expect(resolveQuoteAIGeneration(gemini, { reasoning: "medium", maxOutputTokens: 1024 })).toEqual({ reasoning: "medium", maxOutputTokens: 1024 });
  });

  it("advertises only evidence-free commercial and structural tools", async () => {
    const { boundary, contexts } = modelBoundary([fauxAssistantMessage([fauxText("What room should I paint?")])]);
    await generateQuoteChange(input(), boundary);
    expect(contexts[0].tools?.map((tool) => tool.name)).toEqual([
      "edit_quote_details", "edit_quote_lines", "edit_quote_sections", "copy_quote_work", "move_quote_work", "delete_quote_lines",
    ]);
    for (const registered of contexts[0].tools ?? []) {
      expect(JSON.stringify(registered.parameters)).not.toContain("evidence");
    }
  });

  it("accepts section and line changes with matching evidence-free schemas", async () => {
    const text = "Create a Bedroom section. Bedroom: paint 12 m² at CHF 35 per m².";
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_sections", { sections: [{ title: "Chambre" }] }),
        fauxToolCall("edit_quote_lines", {
          lines: [{ description: "Peinture de la chambre", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "35", amount: "" }],
        }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The bedroom work was added.")]),
    ]);

    const result = await generateQuoteChange({ ...input(), text }, boundary);
    expect(result.quote).toMatchObject({
      sections: [{ title: "Chambre" }],
      lines: [{ description: "Peinture de la chambre", mode: "quantity", quantity: "12", unit: "m²", unitPrice: "35", amount: "" }],
    });
    expect(contexts[0].systemPrompt).toContain("Send ordinary commercial and structural tool arguments. The application validates their shape, ranges and pricing modes, then performs calculations.");
    const lineTool = contexts[0].tools?.find((tool) => tool.name === "edit_quote_lines");
    const sectionTool = contexts[0].tools?.find((tool) => tool.name === "edit_quote_sections");
    expect(lineTool?.description).toBe(editQuoteLinesDescription);
    expect(lineTool?.description).toBe(proposedTools.find((tool) => tool.name === "edit_quote_lines")?.description);
    expect(sectionTool?.description).toBe(proposedTools.find((tool) => tool.name === "edit_quote_sections")?.description);
    expect(sectionTool?.description).toContain("The application generates IDs for new sections");
    expect(sectionTool?.parameters).toMatchObject({ properties: { sections: { items: { properties: { id: { description: expect.stringContaining("Never invent an ID for a new section") } } } } } });
    expect(lineTool?.parameters).toMatchObject({ properties: { lines: { items: { properties: { description: { type: "string" }, mode: {}, quantity: {}, unit: {}, unitPrice: {}, amount: {} } } } } });
    expect(sectionTool?.parameters).toMatchObject({ properties: { sections: { items: { properties: { title: { type: "string" } } } } } });
  });

  it("rejects legacy evidence arguments as unsupported fields", async () => {
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "10" }], evidence: [],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("I will use supported arguments.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), text: "Pose pour 10 CHF." }, boundary);
    expect(result.debug).toMatchObject({ failedCalls: 1, outcome: "unchanged_with_failed_calls", attempts: [{ outcome: "failed", errorCode: "invalid_tool_arguments" }] });
    const rejection = contexts[1].messages.find((message) => message.role === "toolResult" && message.isError);
    expect(JSON.stringify(rejection)).toContain("unsupported fields");
  });

  it("uses fixed mode for a forfait and preserves calculation validation", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Déplacement", mode: "amount", quantity: "", unit: "", unitPrice: "", amount: "47" }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [
          { description: "Contrôle de détecteurs de fumée", mode: "quantity", quantity: "3", unit: "pièce", unitPrice: "19", amount: "" },
          { description: "Déplacement", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "47" },
        ],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The inspection and travel were added.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), text: "Inspect 3 smoke alarms at 19 each. Travel forfait 47.", quote: { ...emptyQuote("Q-1"), vatRegistered: false } }, boundary);
    expect(result.quote?.lines).toHaveLength(2);
    expect(calculateQuote(result.quote!)).toMatchObject({ subtotal: 10_400, total: 10_400 });
    expect(result.debug).toMatchObject({ failedCalls: 1, outcome: "committed_with_failed_calls" });
  });

  it("edits details and a manual line without capture restrictions", async () => {
    const quote = {
      ...emptyQuote("Q-edit"), title: "Ancien titre", customerName: "Ancien client",
      lines: [{ id: "manual", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "100.00" }],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_details", { fields: { title: "Nouveau titre", customerName: "Simon" } }),
        fauxToolCall("edit_quote_lines", { lines: [{ id: "manual", description: "Installation", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "125.00" }] }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("The details and existing line were corrected.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), quote, text: "Nouveau titre et Simon. Installation à 125 CHF.", locale: "fr" }, boundary);
    expect(result.quote).toMatchObject({ title: "Nouveau titre", customerName: "Simon", lines: [{ id: "manual", amount: "125.00" }] });
  });

  it("applies structural moves and rejects a destructive whole turn", async () => {
    const quote = {
      ...emptyQuote("Q-structure"),
      lines: [
        { id: "one", sectionId: "", description: "Pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "10.00" },
        { id: "two", sectionId: "", description: "Finition", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "20.00" },
      ],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([
        fauxToolCall("edit_quote_details", { fields: { title: "Should not persist" } }),
        fauxToolCall("delete_quote_lines", { lineIds: ["one", "two"] }),
      ], { stopReason: "toolUse" }),
    ]);
    await expect(generateQuoteChange({ ...input(), quote, text: "Delete all work.", locale: "en" }, boundary)).rejects.toMatchObject({ diagnostic: { code: "destructive_scope_rejected", outcome: "discarded" } });
  });

  it("rejects oversized drafts and provider payloads before inference", async () => {
    const { boundary, fake } = modelBoundary([fauxAssistantMessage([fauxText("This must not be sent.")])]);
    await expect(generateQuoteChange({ ...input(), quote: { ...input().quote, title: "界".repeat(110_000) } }, boundary)).rejects.toMatchObject({ diagnostic: { code: "draft_context_too_large", notSent: true } });
    expect(fake.getPendingResponseCount()).toBe(1);

    const payload = modelBoundary([fauxAssistantMessage([fauxText("This must not be sent.")])]);
    const oversizedPayload: QuoteAIModelBoundary = {
      ...payload.boundary,
      streamFn: (model, context, options) => {
        options?.onPayload?.({ padding: "x".repeat(600_001) }, model);
        return payload.boundary.streamFn(model, context, options);
      },
    };
    await expect(generateQuoteChange(input(), oversizedPayload)).rejects.toMatchObject({ diagnostic: { code: "provider_payload_limit_exceeded" } });
    expect(payload.fake.getPendingResponseCount()).toBe(1);
  });
});
