import { describe, expect, it } from "vitest";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";

import { emptyQuote } from "../app/lib/quote";
import type { QuoteAIModelBoundary } from "../app/lib/quote-assistant.server";
import { runScenario } from "./runner";
import type { Assertion, Scenario } from "./types";

const databaseUrl = process.env.EVAL_DATABASE_URL;
const evidence = (fields: string[], text: string) => [{ fields, source: "current", text }];

function controlled(responses: FauxResponseStep[]): QuoteAIModelBoundary {
  const provider = fauxProvider();
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  return { model: provider.getModel(), timeoutMs: 1_000, streamFn: (model, context, options) => models.streamSimple(model, context, options) };
}

function scenario(step: Scenario["steps"][number], start = emptyQuote("Q-EVAL")): Scenario {
  return {
    id: `runner-${crypto.randomUUID()}`,
    version: 1,
    title: "Runner seam",
    profession: "joinery",
    provenance: { kind: "synthetic-edge", alias: "runner-test", notes: ["Synthetic test data."] },
    review: { inputs: "approved", expectations: "approved", provider: "blocked", note: "Controlled transport only." },
    locale: "en",
    startingQuote: start,
    history: [],
    steps: [step],
    requiredClarification: [],
    forbiddenMutations: [],
    humanReview: ["Wording remains unreviewed."],
  };
}

const titleAssertion = (title: string): Assertion => ({ label: "title", path: "quote.title", operator: "equals", expected: title });

describe.runIf(Boolean(databaseUrl))("evaluation runner real HTTP and PostgreSQL seam", () => {
  it("marks a false success as failed when it commits no claimed change", async () => {
    const run = await runScenario(scenario({ kind: "artisan", text: "Set title Changed", assertions: [titleAssertion("Changed")] }), {
      databaseUrl: databaseUrl!, modelBoundary: controlled([fauxAssistantMessage([fauxText("Changed.")])]),
      modelSettings: { transport: "faux-controlled", providerCalls: false, intentionallyNoop: true },
    });
    expect(run.automated).toBe("failed");
    expect(run.model).toMatchObject({ provider: "faux", settings: {
      transport: "faux-controlled", providerCalls: false, intentionallyNoop: true,
      generation: { maxTokens: 4096, maxRetries: 0, cacheRetention: "none", thinkingLevel: "off", timeoutMs: 1_000 },
    } });
    expect(run.revision.promptTools).toMatch(/^[a-f0-9]{64}$/);
    expect(run.turns[0]).toMatchObject({ step: 0, outcome: "unchanged", after: { title: "" } });
  });

  it("keeps the real tool executor when an invalid call is repaired", async () => {
    const text = "Set title Repaired";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Repaired"), { label: "one failed call", path: "failedCalls", operator: "equals", expected: 1 }] }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Repaired" } })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Repaired" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Repaired."),
      ]),
    });
    expect(run.automated).toBe("passed");
    expect(run.turns[0]).toMatchObject({ failedCalls: 1, outcome: "committed_with_failed_calls", after: { title: "Repaired" } });
  });

  it("commits partial work below the third failed call", async () => {
    const text = "Set title Partial";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Partial"), { label: "one failed call", path: "failedCalls", operator: "equals", expected: 1 }] }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([
          fauxToolCall("edit_quote_details", { fields: { title: "Partial" }, evidence: evidence(["title"], text) }),
          fauxToolCall("edit_quote_details", { fields: { title: "Missing evidence" } }),
        ], { stopReason: "toolUse" }),
        fauxAssistantMessage("Partial change saved."),
      ]),
    });
    expect(run.turns[0]).toMatchObject({ outcome: "committed_with_failed_calls", failedCalls: 1, after: { title: "Partial" } });
  });

  it("discards staged success with the whole turn at the third failed call", async () => {
    const start = { ...emptyQuote("Q-EVAL"), title: "Before" };
    const text = "Break it, then stage Staged title.";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Before"), { label: "terminal failure", path: "outcome", operator: "equals", expected: "failed_call_limit_reached" }] }, start), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([
          fauxToolCall("unknown_tool", {}),
          fauxToolCall("edit_quote_details", { fields: { title: "Staged" }, evidence: evidence(["title"], text) }),
          fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}),
        ], { stopReason: "toolUse" }),
      ]),
    });
    expect(run.turns[0]).toMatchObject({ outcome: "failed_call_limit_reached", failedCalls: 3, after: { title: "Before" }, diagnostic: { attempts: expect.arrayContaining([expect.objectContaining({ name: "edit_quote_details", outcome: "applied" })]) } });
  });

  it("preserves a concurrent manual save and reports the assistant response stale", async () => {
    const text = "Set title Assistant";
    const run = await runScenario(scenario({
      kind: "artisan", text, concurrentManualQuote: { ...emptyQuote("Q-EVAL"), title: "Manual" },
      assertions: [titleAssertion("Manual"), { label: "stale", path: "outcome", operator: "equals", expected: "stale" }],
    }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Assistant" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Assistant."),
      ]),
    });
    expect(run).toMatchObject({ modelCalls: 2 });
    expect(run.turns[0]).toMatchObject({ step: 0, outcome: "stale", after: { title: "Manual" }, debug: { outcome: "stale", attempts: [{ name: "edit_quote_details", outcome: "applied" }] } });
  });

  it("marks absent assertion values invalid and requires explicit terminal outcomes", async () => {
    const invalid = await runScenario(scenario({ kind: "artisan", text: "Anything", assertions: [{ label: "missing", path: "quote.title", operator: "equals" }] }), {
      databaseUrl: databaseUrl!, modelBoundary: controlled([]),
    });
    expect(invalid).toMatchObject({ automated: "invalid", turns: [{ assertions: [{ label: "Scenario step 1 has an assertion without an expected value" }] }] });

    const start = { ...emptyQuote("Q-EVAL"), title: "Before" };
    const terminal = await runScenario(scenario({ kind: "artisan", text: "Break", assertions: [titleAssertion("Before")] }, start), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([fauxAssistantMessage([fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {}), fauxToolCall("unknown_tool", {})], { stopReason: "toolUse" })]),
    });
    expect(terminal).toMatchObject({ automated: "failed", turns: [{ assertions: expect.arrayContaining([expect.objectContaining({ label: "Terminal HTTP outcome is explicitly expected", passed: false })]) }] });
  });

  it("leaves human review pending after success", async () => {

    const text = "Set title Reviewed later";
    const run = await runScenario(scenario({ kind: "artisan", text, assertions: [titleAssertion("Reviewed later")] }), {
      databaseUrl: databaseUrl!,
      modelBoundary: controlled([
        fauxAssistantMessage([fauxToolCall("edit_quote_details", { fields: { title: "Reviewed later" }, evidence: evidence(["title"], text) })], { stopReason: "toolUse" }),
        fauxAssistantMessage("Saved."),
      ]),
    });
    expect(run).toMatchObject({ automated: "passed", human: "pending" });
  });
});
