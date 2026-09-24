import { expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { runScenario } from "./runner";
import { scenarios } from "./scenarios";

it.runIf(Boolean(process.env.EVAL_DATABASE_URL))("asks before editing an ambiguous Quote Line and applies the clarified correction", async () => {
  const scenario = scenarios.find(item => item.id === "ambiguous-panel-correction")!;
  const provider = fauxProvider();
  provider.setResponses([
    fauxAssistantMessage("Which wing's panel area should I change?"),
    fauxAssistantMessage([fauxToolCall("edit_quote_lines", { lines: [{
      id: scenario.startingQuote.lines[1]!.id,
      description: scenario.expectedQuote!.lines[1]!.description,
      mode: "quantity", quantity: "4", unit: "m2", unitPrice: "10.00", amount: "",
    }] })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Updated the west wing only."),
  ]);
  const models = createModels();
  models.setProvider(provider.provider);
  const run = await runScenario(scenario, { databaseUrl: process.env.EVAL_DATABASE_URL!, modelBoundary: {
    model: provider.getModel(), timeoutMs: 1000, streamFn: (model, context, options) => models.streamSimple(model, context, options),
  } });
  expect(run.automated).toBe("passed");
  expect(run.turns.map(turn => turn.outcome)).toEqual(["unchanged", "committed"]);
  expect(run.turns[0].after).toEqual(scenario.startingQuote);
  expect(run.turns[0].message).toContain("?");
  expect(run.turns[0].debug?.attempts).toEqual([]);
  expect(run.turns[1].after.lines[0]).toEqual(run.turns[0].after.lines[0]);
  expect(run.turns[1].after.lines[1].quantity).toBe("4");
});
