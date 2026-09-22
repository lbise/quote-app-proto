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

type ToolFields = string[];

function controlled(responses: FauxResponseStep[]): QuoteAIModelBoundary {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  return { model: provider.getModel(), timeoutMs: 1_000, streamFn: (model, context, options) => models.streamSimple(model, context, options) };
}

function evidence(fields: ToolFields, text: string) {
  return [{ fields, source: "current", text }];
}

function lineCall(scenario: Scenario, overrides: Partial<Pick<QuoteLine, "quantity" | "unit" | "unitPrice" | "amount">> = {}) {
  const text = (scenario.steps[0] as { text: string }).text;
  const expected = scenario.expectedQuote!.lines[0]!;
  const fields = ["/lines/0/description", "/lines/0/mode"];
  if (expected.mode === "fixed") fields.push("/lines/0/amount");
  else fields.push("/lines/0/quantity", "/lines/0/unit", "/lines/0/unitPrice");
  const citations = scenario.id === "contract-split-evidence"
    ? [
      { fields: ["/lines/0/description", "/lines/0/quantity", "/lines/0/unit"], source: "current", text: "Pour l’orangerie fictive, note une ligne de pose de ruban d’étanchéité. La longueur mesurée est de 12,75 m." },
      { fields: ["/lines/0/mode", "/lines/0/unitPrice"], source: "current", text: "Le tarif convenu pour cette pose est de 6,80 CHF par mètre." },
    ]
    : evidence(fields, text);
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
    evidence: citations,
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

function mixedBatch(scenario: Scenario, context: Context, start: number, end: number, spliceEvidence = false) {
  const step = scenario.steps[0];
  if (step.kind !== "artisan") throw new Error("Expected Artisan notes");
  const paragraphs = step.text.split("\n\n");
  const ids = sectionIdsFromResult(context);
  const lines = scenario.expectedQuote!.lines.slice(start, end).map(({ id: _id, sectionId: _section, ...item }, index) => ({ ...item, sectionId: ids[start + index < 4 ? 0 : 1] }));
  const citations = lines.flatMap((item, index) => {
    const prefix = `/lines/${index}`;
    const passage = paragraphs[start + index < 4 ? 2 : 4];
    const fields = [`${prefix}/description`, `${prefix}/mode`, ...(item.mode === "fixed" ? [`${prefix}/amount`] : [`${prefix}/quantity`, `${prefix}/unit`, `${prefix}/unitPrice`])];
    if (item.mode === "fixed") return evidence(fields, passage);
    if (spliceEvidence) return evidence(fields, `${paragraphs[1]}... ${passage}`);
    return [
      ...evidence([`${prefix}/description`, `${prefix}/mode`, `${prefix}/unit`, `${prefix}/unitPrice`], paragraphs[1]),
      ...evidence([`${prefix}/quantity`], passage),
    ];
  });
  if (start === 0) citations.push(...evidence(["/lines/0/description"], paragraphs[3]));
  return fauxAssistantMessage([fauxToolCall("edit_quote_lines", { lines, evidence: citations })], { stopReason: "toolUse" });
}

function acceptedResponses(scenario: Scenario): FauxResponseStep[] {
  if (scenario.id === "contract-mixed-batches") {
    const step = scenario.steps[0];
    if (step.kind !== "artisan") throw new Error("Expected Artisan notes");
    return [
      fauxAssistantMessage([fauxToolCall("edit_quote_sections", { sections: [{ title: "Atelier" }, { title: "Réserve" }], evidence: evidence(["/sections/0/title", "/sections/1/title"], step.text.split("\n\n")[0]) })], { stopReason: "toolUse" }),
      context => mixedBatch(scenario, context, 0, 5),
      context => mixedBatch(scenario, context, 5, 8),
      fauxAssistantMessage("Les huit postes ont été ajoutés dans les deux rubriques."),
    ];
  }
  if (scenario.id !== "contract-section-assignment") return [lineCall(scenario), fauxAssistantMessage("Modification enregistrée.")];
  const text = (scenario.steps[0] as { text: string }).text;
  const expected = scenario.expectedQuote!.lines[0]!;
  return [
    fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
      sections: [{ title: "Galerie nord" }],
      evidence: evidence(["/sections/0/title"], text),
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
      evidence: evidence(["/lines/0/description", "/lines/0/mode", "/lines/0/amount"], text),
    })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Rubrique et ligne enregistrées."),
  ];
}

describe("synthetic contract scenarios", () => {
  it("contains only fictional French inputs and keeps prose review outside automated contract checks", () => {
    expect(contractScenarios).toHaveLength(5);
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

  it("rejects spliced evidence in a later batch and rolls back earlier accepted work at the third failure", async () => {
    const scenario = publishedContractScenarios.find(item => item.id === "contract-mixed-batches")!;
    const accepted = acceptedResponses(scenario);
    const run = await runScenario(scenario, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      accepted[0], accepted[1],
      ...Array.from({ length: 3 }, (): FauxResponseStep => context => mixedBatch(scenario, context, 5, 8, true)),
    ]) });
    expect(run.checks).toEqual({ contract: "failed", commercial: "failed" });
    expect(run.turns[0]).toMatchObject({ outcome: "failed_call_limit_reached", failedCalls: 3 });
    expect(run.turns[0].after).toEqual(scenario.startingQuote);
    expect(run.turns[0].diagnostic?.attempts?.map(attempt => attempt.outcome)).toEqual(["applied", "applied", "failed", "failed", "failed"]);
  });

  it("rejects unrelated section names even when every amount and assignment is correct", async () => {
    const scenario = publishedContractScenarios.find(item => item.id === "contract-mixed-batches")!;
    const accepted = acceptedResponses(scenario);
    const step = scenario.steps[0];
    if (step.kind !== "artisan") throw new Error("Expected Artisan notes");
    accepted[0] = fauxAssistantMessage([fauxToolCall("edit_quote_sections", {
      sections: [{ title: "Grenier" }, { title: "Cave" }], evidence: evidence(["/sections/0/title", "/sections/1/title"], step.text),
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
      ["contract-split-evidence", "mètre"],
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

    const split = publishedContractScenarios.find((scenario) => scenario.id === "contract-split-evidence")!;
    const undeclaredSymbol = await runScenario(split, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      lineCall(split, { unit: "ml" }), fauxAssistantMessage("Modification enregistrée."),
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

  it("separates a repaired tool-contract failure from correct final commercial state", async () => {
    const fixed = publishedContractScenarios.find((scenario) => scenario.id === "contract-fixed-line")!;
    const repaired = await runScenario(fixed, { databaseUrl: databaseUrl!, modelBoundary: controlled([
      fauxAssistantMessage([fauxToolCall("edit_quote_lines", {
        lines: [{ description: "Réglage final des volets de la verrière", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "486.50" }],
      })], { stopReason: "toolUse" }),
      lineCall(fixed),
      fauxAssistantMessage("Modification enregistrée."),
    ]) });
    expect(repaired.automated).toBe("failed");
    expect(repaired.checks).toEqual({ contract: "failed", commercial: "passed" });
    expect(repaired.turns[0]).toMatchObject({ outcome: "committed_with_failed_calls", failedCalls: 1 });
  });
});
