import { describe, expect, it } from "vitest";
import { createModels, type Context, type ToolResultMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";

import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import type { QuoteLine } from "../app/lib/quote";
import { runScenario } from "./runner";
import { contractScenarios } from "./contract-scenarios";
import { scenarios } from "./scenarios";
import type { Scenario } from "./types";

const databaseUrl = process.env.EVAL_DATABASE_URL;
const publishedContractScenarios = scenarios.filter((scenario) => scenario.suite === "contract");

function controlled(responses: FauxResponseStep[]): QuoteAIModelBoundary {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  return { model: provider.getModel(), timeoutMs: 1_000, streamFn: (model, context, options) => models.streamSimple(model, context, options) };
}

function lineCall(scenario: Scenario, overrides: Partial<Pick<QuoteLine, "quantity" | "unit" | "unitPrice" | "amount">> = {}) {
  const expected = scenario.expectedQuote!.lines[0]!;
  return fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
    lines: [{
      description: expected.description,
      mode: expected.mode,
      quantity: expected.quantity,
      unit: expected.unit,
      unitPrice: expected.unitPrice,
      amount: expected.amount,
      ...overrides,
    }],
  })], { stopReason: "toolUse" });
}

/** The line call consumes the ID reported by the specific section tool result; it never predicts an ID. */
function sectionIdsFromResult(context: Context): string[] {
  const result = [...context.messages].reverse().find((message): message is ToolResultMessage => message.role === "toolResult" && message.toolName === "edit_quote_sections" && !message.isError);
  const text = result?.content.find((block): block is { type: "text"; text: string } => block.type === "text")?.text;
  if (!text) throw new Error("The section tool result did not contain its public JSON result.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("The section tool result was not valid JSON."); }
  if (!value || typeof value !== "object" || !("changedFields" in value) || !Array.isArray(value.changedFields)) throw new Error("The section tool result did not report changed fields.");
  const ids = value.changedFields.filter((item): item is string => typeof item === "string" && item.startsWith("section:")).map(field => field.slice("section:".length));
  if (!ids.length || ids.some(id => !id)) throw new Error("The section tool result did not report its generated IDs.");
  return ids;
}

function mixedBatch(scenario: Scenario, context: Context, start: number, end: number) {
  const ids = sectionIdsFromResult(context);
  const lines = scenario.expectedQuote!.lines.slice(start, end).map(({ id: _id, sectionId: _section, ...item }, index) => ({ ...item, sectionId: ids[start + index < 4 ? 0 : 1] }));
  return fauxAssistantMessage([fauxToolCall("edit_quote_lines", { lines })], { stopReason: "toolUse" });
}

function acceptedResponses(scenario: Scenario): FauxResponseStep[] {
  if (scenario.id === "contract-mixed-batches") {
    return [
      fauxAssistantMessage([fauxToolCall("edit_quote_sections", { sections: [{ title: "Atelier" }, { title: "Réserve" }] })], { stopReason: "toolUse" }),
      context => mixedBatch(scenario, context, 0, 5),
      context => mixedBatch(scenario, context, 5, 8),
      fauxAssistantMessage("Les huit postes ont été ajoutés dans les deux rubriques."),
    ];
  }
  if (scenario.id !== "contract-section-assignment") return [lineCall(scenario), fauxAssistantMessage("Modification enregistrée.")];
  const expected = scenario.expectedQuote!.lines[0]!;
  return [
    fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
      sections: [{ title: "Galerie nord" }],
    })], { stopReason: "toolUse" }),
    (context) => fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
      lines: [{
        sectionId: sectionIdsFromResult(context)[0],
        description: expected.description,
        mode: expected.mode,
        quantity: expected.quantity,
        unit: expected.unit,
        unitPrice: expected.unitPrice,
        amount: expected.amount,
      }],
    })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Rubrique et ligne enregistrées."),
  ];
}

describe("synthetic contract scenarios", () => {
  it("contains four small fictional French checks and one combined check", () => {
    expect(contractScenarios).toHaveLength(5);
    expect(contractScenarios.filter((scenario) => scenario.id !== "contract-mixed-batches")).toHaveLength(4);
    expect(publishedContractScenarios.map((scenario) => scenario.id)).toEqual(contractScenarios.map((scenario) => scenario.id));
    for (const scenario of contractScenarios) {
      expect(scenario.suite).toBe("contract");
      expect(scenario.provenance).toMatchObject({ kind: "synthetic-contract", alias: "fictional-contract-fixture" });
      expect(scenario.locale).toBe("fr");
      expect(scenario.startingQuote.sections).toEqual([]);
      expect(scenario.startingQuote.lines).toEqual([]);
      expect(scenario.steps).toHaveLength(1);
      expect(scenario.humanReview.join(" ")).toMatch(/fidèle|fidèlement/i);
      expect(scenario.steps[0]!.assertions.some((assertion) => assertion.path === "quote.lines[0].description" && assertion.operator === "equals")).toBe(false);
    }
  });
});

describe.runIf(Boolean(databaseUrl))("contract checks through real HTTP, tools and isolated PostgreSQL", () => {
  it("covers mixed pricing, distant shared rates and continuation across batches", async () => {
    const scenario = publishedContractScenarios.find(item => item.id === "contract-mixed-batches");
    expect(scenario).toBeDefined();
    const run = await runScenario(scenario!, { databaseUrl: databaseUrl!, modelBoundary: controlled(acceptedResponses(scenario!)) });
    expect(run.checks).toEqual({ contract: "passed", commercial: "passed" });
    expect(run.modelCalls).toBe(4);
    expect(run.turns[0].after.sections).toHaveLength(2);
    expect(run.turns[0].after.lines).toHaveLength(8);
    expect(run.turns[0].assertions.filter(item => !item.passed)).toEqual([]);
  });

  it("rolls back earlier accepted work at the third rejected later call", async () => {
    const scenario = publishedContractScenarios.find(item => item.id === "contract-mixed-batches")!;
    const accepted = acceptedResponses(scenario);
    const rejected = (): FauxResponseStep => fauxAssistantMessage([fauxToolCall("unknown_tool", {})], { stopReason: "toolUse" });
    const run = await runScenario(scenario, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      accepted[0], accepted[1], rejected(), rejected(), rejected(),
    ]) });
    expect(run.checks).toEqual({ contract: "failed", commercial: "failed" });
    expect(run.turns[0]).toMatchObject({ outcome: "failed_call_limit_reached", failedCalls: 3 });
    expect(run.turns[0].after).toEqual(scenario.startingQuote);
    expect(run.turns[0].diagnostic?.attempts?.map(attempt => attempt.outcome)).toEqual(["applied", "applied", "failed", "failed", "failed"]);
  });

  it("rejects unrelated section names even when every amount and assignment is correct", async () => {
    const scenario = publishedContractScenarios.find(item => item.id === "contract-mixed-batches")!;
    const accepted = acceptedResponses(scenario);
    accepted[0] = fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
      sections: [{ title: "Grenier" }, { title: "Cave" }],
    })], { stopReason: "toolUse" });
    const run = await runScenario(scenario, { databaseUrl: databaseUrl!, modelBoundary: controlled(accepted) });
    expect(run.checks).toEqual({ contract: "passed", commercial: "failed" });
  });

  it("does not mistake successful first-batch execution for complete commercial work", async () => {
    const scenario = publishedContractScenarios.find(item => item.id === "contract-mixed-batches")!;
    const accepted = acceptedResponses(scenario);
    const run = await runScenario(scenario, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      accepted[0], accepted[1], fauxAssistantMessage("Terminé."),
    ]) });
    expect(run.checks).toEqual({ contract: "passed", commercial: "failed" });
    expect(run.automated).toBe("failed");
    expect(run.turns[0].after.lines).toHaveLength(5);
  });

  it.each(publishedContractScenarios)("accepts $id with the real tool executor", async (scenario) => {
    const run = await runScenario(scenario, { databaseUrl: databaseUrl!, modelBoundary: controlled(acceptedResponses(scenario)) });
    expect(run.automated).toBe("passed");
    expect(run.checks).toEqual({ contract: "passed", commercial: "passed" });
    expect(scenario.expectedCalculation).toBeDefined();
    expect(run.turns[0].assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "calculation.total", expected: scenario.expectedCalculation!.total, passed: true }),
    ]));
    expect(run.turns[0]).toMatchObject({ outcome: "committed", failedCalls: 0, debug: { attempts: expect.arrayContaining([expect.objectContaining({ outcome: "applied" })]) } });
  });

  it("accepts French unit aliases but rejects a different physical unit", async () => {
    const aliases = [
      ["contract-quantity-line", "pce"],
      ["contract-multi-paragraph-facts", "mètre"],
    ] as const;
    for (const [id, unit] of aliases) {
      const scenario = publishedContractScenarios.find((item) => item.id === id)!;
      const run = await runScenario(scenario, { databaseUrl: databaseUrl!, modelBoundary: controlled([lineCall(scenario, { unit }), fauxAssistantMessage("Modification enregistrée.")]) });
      expect(run.automated).toBe("passed");
      expect(run.checks).toEqual({ contract: "passed", commercial: "passed" });
    }

    const quantity = publishedContractScenarios.find((scenario) => scenario.id === "contract-quantity-line")!;
    const wrongPhysicalUnit = await runScenario(quantity, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      lineCall(quantity, { unit: "kg" }), fauxAssistantMessage("Modification enregistrée."),
    ]) });
    expect(wrongPhysicalUnit.automated).toBe("failed");
    expect(wrongPhysicalUnit.checks).toEqual({ contract: "passed", commercial: "failed" });

    const facts = publishedContractScenarios.find((scenario) => scenario.id === "contract-multi-paragraph-facts")!;
    const undeclaredSymbol = await runScenario(facts, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      lineCall(facts, { unit: "ml" }), fauxAssistantMessage("Modification enregistrée."),
    ]) });
    expect(undeclaredSymbol.checks).toEqual({ contract: "passed", commercial: "failed" });
  });

  it("marks an extra empty section as a commercial failure", async () => {
    const fixed = publishedContractScenarios.find((scenario) => scenario.id === "contract-fixed-line")!;
    const withExtraSection = await runScenario(fixed, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      fauxAssistantMessage([fauxToolCall("edit_quote_sections", { sections: [{ title: "" }] })], { stopReason: "toolUse" }),
      lineCall(fixed),
      fauxAssistantMessage("Modification enregistrée."),
    ]) });
    expect(withExtraSection.automated).toBe("failed");
    expect(withExtraSection.checks).toEqual({ contract: "passed", commercial: "failed" });
  });

  it("fails a no-op and an attempted wrong price", async () => {
    const quantity = publishedContractScenarios.find((scenario) => scenario.id === "contract-quantity-line")!;
    const noOp = await runScenario(quantity, { databaseUrl: databaseUrl!, modelBoundary: controlled([fauxAssistantMessage("Je n’ai rien modifié.")]) });
    expect(noOp.automated).toBe("failed");

    const wrongPrice = await runScenario(quantity, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      lineCall(quantity, { unitPrice: "19.40" }), fauxAssistantMessage("Modification enregistrée."),
    ]) });
    expect(wrongPrice.automated).toBe("failed");
  });

  it("separates a repaired invalid call from correct final commercial state", async () => {
    const fixed = publishedContractScenarios.find((scenario) => scenario.id === "contract-fixed-line")!;
    const repaired = await runScenario(fixed, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Réglage final des volets de la verrière", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "486.50" }],
        unexpected: true,
      })], { stopReason: "toolUse" }),
      lineCall(fixed),
      fauxAssistantMessage("Modification enregistrée."),
    ]) });
    expect(repaired.automated).toBe("failed");
    expect(repaired.checks).toEqual({ contract: "failed", commercial: "passed" });
    expect(repaired.turns[0]).toMatchObject({ outcome: "committed_with_failed_calls", failedCalls: 1 });
  });
});
