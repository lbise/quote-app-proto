import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Context } from "@earendil-works/pi-ai";

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

describe("pi Quote assistant model boundary", () => {
  it("accepts retained Artisan facts but never treats an assistant reply as price evidence", async () => {
    for (const role of ["artisan", "assistant"] as const) {
      const { boundary } = modelBoundary([
        fauxAssistantMessage([fauxToolCall("add_quote_line", { description: "Pose", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "75.00", evidence: [{ field: "amount", text: "75" }] })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("Added the supplied fixed price.")]),
      ]);
      const pending = generateQuoteChange({ ...input(), text: "Capture the installation using my earlier price.", messages: [{ role, fr: "Pose pour 75 CHF.", en: "Installation for CHF 75." }] }, boundary);
      if (role === "artisan") expect((await pending).quote?.lines[0].amount).toBe("75.00");
      else await expect(pending).rejects.toThrow("could not complete");
    }
  });

  it("sends only bounded work and conversation context, never dedicated identity or credentials", async () => {
    const { boundary, contexts } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("read_work", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Quelle surface faut-il peindre ?")]),
    ]);
    const current = { ...input(), locale: "fr" as const, messages: Array.from({ length: 30 }, (_, index) => ({ role: "artisan" as const, fr: `Travaux ${index}`, en: `Work ${index}` })) };
    current.quote.customerName = "PRIVATE_CUSTOMER";
    current.quote.businessContact = "PRIVATE_CONTACT";
    current.quote.terms = "PRIVATE_TERMS";
    current.quote.lines = [{ id: "supplied", sectionId: "", description: "Peinture RAL 9010", mode: "quantity", quantity: "", unit: "", unitPrice: "", amount: "" }];
    await generateQuoteChange(current, boundary);
    const content = contexts[0].messages[0].content;
    const text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("");
    const payload = JSON.parse(text);
    expect(payload).toMatchObject({ locale: "fr", historyOmitted: true });
    expect(payload.messages).toHaveLength(24);
    expect(payload.messages[0]).toEqual({ role: "artisan", text: "Travaux 6" });
    const sent = JSON.stringify(contexts);
    expect(sent).toContain("Peinture RAL 9010");
    expect(sent).not.toMatch(/PRIVATE_|customerName|businessContact|apiKey/);
  });

  it("rejects raw tool arguments rather than accepting pi's type coercion", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("add_quote_line", { description: "Peinture", mode: "quantity", quantity: 2, unit: "", unitPrice: "", amount: "", evidence: [{ field: "quantity", text: "2" }] })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Added.")]),
    ]);
    const failure = generateQuoteChange({ ...input(), text: "Paint 2 walls." }, boundary);
    await expect(failure).rejects.toThrow("could not complete");
    await expect(failure).rejects.toMatchObject({
      diagnostic: {
        phase: "tool",
        code: "invalid_tool_arguments",
        tool: "add_quote_line",
        toolCall: {
          name: "add_quote_line",
          arguments: { description: "Peinture", mode: "quantity", quantity: 2, unit: "", unitPrice: "", amount: "", evidence: [{ field: "quantity", text: "2" }] },
        },
        llmRequest: {
          model: { provider: expect.any(String), id: expect.any(String) },
          systemPrompt: expect.stringContaining("registered Easy Quote tools"),
          messages: expect.any(Array),
          tools: expect.arrayContaining([expect.objectContaining({ name: "add_quote_line", parameters: expect.any(Object) })]),
          options: expect.objectContaining({ maxTokens: 4096, timeoutMs: expect.any(Number) }),
        },
      },
    });
  });

  it("bounds accumulated work context in bytes before sending the next model request", async () => {
    const { boundary, fake } = modelBoundary([
      fauxAssistantMessage(Array.from({ length: 10 }, () => fauxToolCall("read_work", {})), { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Finished.")]),
    ]);
    const work = input();
    work.quote.lines = Array.from({ length: 10 }, (_, index) => ({ id: `line-${index}`, sectionId: "", description: "界".repeat(800), mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "" }));
    await expect(generateQuoteChange(work, boundary)).rejects.toThrow("could not complete");
    expect(fake.getPendingResponseCount()).toBe(1);
  });

  it("rejects an oversized intermediate model response before another round", async () => {
    const { boundary, fake } = modelBoundary([
      fauxAssistantMessage([fauxText("x".repeat(65_000)), fauxToolCall("read_work", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Finished.")]),
    ]);
    await expect(generateQuoteChange(input(), boundary)).rejects.toThrow("could not complete");
    expect(fake.getPendingResponseCount()).toBe(1);
  });

  it("rejects a batch exceeding twelve tool calls", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage(Array.from({ length: 13 }, () => fauxToolCall("read_work", {})), { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Finished.")]),
    ]);
    await expect(generateQuoteChange(input(), boundary)).rejects.toThrow("could not complete");
  });

  it("times out even when the model transport does not cooperate with cancellation", async () => {
    const { boundary } = modelBoundary([]);
    const stalled: QuoteAIModelBoundary = { ...boundary, timeoutMs: 20, streamFn: () => new Promise(() => {}) };
    await expect(generateQuoteChange(input(), stalled)).rejects.toThrow("could not complete");
  }, 500);

  it("stops after six model rounds instead of accepting an exhausted run", async () => {
    const { boundary, fake } = modelBoundary([
      ...Array.from({ length: 6 }, () => fauxAssistantMessage([fauxToolCall("read_work", {})], { stopReason: "toolUse" })),
      fauxAssistantMessage([fauxText("Finished.")]),
    ]);
    await expect(generateQuoteChange(input(), boundary)).rejects.toThrow("could not complete");
    expect(fake.getPendingResponseCount()).toBe(1);
  });

  it("rejects an unregistered tool even if a later model reply claims success", async () => {
    const { boundary, fake } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("publish_quote", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Published.")]),
    ]);
    await expect(generateQuoteChange(input(), boundary)).rejects.toThrow("could not complete");
    expect(fake.getPendingResponseCount()).toBe(1);
  });
  it("calculates typed room dimensions and accepts compact CHF pricing", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("add_quote_line", {
        description: "Repeindre la chambre d’Eugènie en vert pomme. Chambre de 2x4m sur 3m de plafond",
        mode: "quantity",
        quantityCalculation: {
          kind: "room_wall_area",
          length: "2",
          width: "4",
          height: "3",
          source: "2x4m sur 3m de plafond",
        },
        unit: "m²",
        unitPrice: "12.50",
        evidence: [{ field: "unitPrice", text: "12.50chf" }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("J’ai ajouté la ligne; la surface reste à confirmer.")]),
    ]);
    const result = await generateQuoteChange({
      ...input(),
      locale: "fr",
      text: "Je veux repeindre la chambre d'eugènie en vert pomme. Chambre de 2x4m sur 3m de plafond. Prix au m2 12.50chf",
    }, boundary);
    expect(result.quote?.lines[0]).toMatchObject({
      description: "Repeindre la chambre d’Eugènie en vert pomme. Chambre de 2x4m sur 3m de plafond",
      unit: "m²",
      unitPrice: "12.50",
      quantity: "36",
    });
    expect(calculateQuote(result.quote)).toMatchObject({ subtotal: 45_000 });
  });

  it("creates a line with empty commercial fields when the Artisan gives only work details", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("add_quote_line", {
        description: "Repeindre la chambre d’Eugènie en vert pomme",
        mode: "quantity",
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("J’ai ajouté le travail. Les dimensions et le prix restent à compléter.")]),
    ]);
    const result = await generateQuoteChange({
      ...input(),
      text: "Il faut repeindre la chambre d’Eugènie en vert pomme.",
    }, boundary);
    expect(result.quote?.lines).toEqual([expect.objectContaining({
      description: "Repeindre la chambre d’Eugènie en vert pomme",
      mode: "quantity",
      quantity: "",
      unit: "",
      unitPrice: "",
      amount: "",
    })]);
  });

  it("refines existing lines and repeats a section through the targeted tools", async () => {
    const work = {
      ...emptyQuote("Q-refine"),
      sections: [{ id: "bedroom", title: "Chambre" }],
      lines: [
        { id: "wall", sectionId: "bedroom", description: "Habillage mural", mode: "quantity" as const, quantity: "12", unit: "m²", unitPrice: "40.00", amount: "" },
        { id: "tablet", sectionId: "bedroom", description: "Pose de tablette", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "150.00" },
      ],
    };
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("read_work", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([
        fauxToolCall("update_quote_line", { lineId: "wall", fields: { unitPrice: "45.00" }, evidence: [{ field: "unitPrice", text: "45" }] }),
        fauxToolCall("duplicate_quote_section", { sectionId: "bedroom", measurementPolicy: "unknown" }),
      ], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Updated the cladding price and copied Chambre with its unknown area left blank.")]),
    ]);
    const result = await generateQuoteChange({ ...input(), quote: work, text: "Set the cladding price to 45 CHF and copy Chambre; I do not know the area." }, boundary);
    expect(result.changed).toHaveLength(3);
    expect(result.quote?.lines).toEqual([
      expect.objectContaining({ id: "wall", unitPrice: "45.00" }),
      expect.objectContaining({ id: "tablet", amount: "150.00" }),
      expect.objectContaining({ quantity: "", unit: "m²", unitPrice: "45.00" }),
      expect.objectContaining({ amount: "150.00" }),
    ]);
    expect(result.changedFields).toEqual([expect.stringMatching(/^section:section-/)]);
    expect(result.message).toContain("fixed amount retained: CHF 150.00");
    expect(result.message).toContain("quantity left blank (measurement unknown)");
  });

  it("captures Customer details supplied alongside the work", async () => {
    const { boundary } = modelBoundary([
      fauxAssistantMessage([fauxToolCall("set_customer_info", {
        name: "Simon Rowell",
        address: "chemin des Glycines 14, 1007 Lausanne",
        contact: "079 123 45 67",
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("J’ai enregistré les coordonnées du client.")]),
    ]);
    const result = await generateQuoteChange({
      ...input(),
      locale: "fr",
      text: "Client Simon Rowell, chemin des Glycines 14, 1007 Lausanne, tél. 079 123 45 67.",
    }, boundary);
    expect(result.quote).toMatchObject({
      customerName: "Simon Rowell",
      customerAddress: "chemin des Glycines 14, 1007 Lausanne",
      customerContact: "079 123 45 67",
    });
    expect(result.changedFields).toEqual(["customer"]);
  });

  it("opens publication review only after an explicit publication request", async () => {
    const { boundary } = modelBoundary([fauxAssistantMessage([fauxText("The work is ready to review.")])]);
    expect((await generateQuoteChange({ ...input(), text: "Please review the Quote before I publish it." }, boundary)).reviewPublication).toBe(true);
    const second = modelBoundary([fauxAssistantMessage([fauxText("The work is ready.")])]);
    expect((await generateQuoteChange({ ...input(), text: "Do not publish the Quote yet." }, second.boundary)).reviewPublication).toBe(false);
  });

  it("returns focused clarification without replacing an incomplete Working Draft", async () => {
    const { boundary, contexts } = modelBoundary([fauxAssistantMessage([fauxText("Which room needs painting?")])]);
    const result = await generateQuoteChange(input(), boundary);
    expect(result).toMatchObject({ quote: null, changed: [], message: "Which room needs painting?", reviewPublication: false });
    expect(contexts[0].tools?.map((tool) => tool.name)).toEqual([
      "read_work", "set_customer_info", "add_quote_line", "supply_missing_line_fields",
      "update_quote_line", "create_quote_section", "rename_quote_section", "move_quote_line",
      "duplicate_quote_line", "duplicate_quote_section",
    ]);
  });
});
