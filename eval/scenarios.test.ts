import { describe, expect, it } from "vitest";

import { evaluateAssertions } from "./assertions";
import { scenarios } from "./scenarios";

describe("evaluation scenario library", () => {
  it("keeps the 26-scenario library range separate from five contract fixtures", () => {
    const libraryScenarios = scenarios.filter((scenario) => scenario.suite !== "contract");
    const contracts = scenarios.filter((scenario) => scenario.suite === "contract");
    expect(libraryScenarios.length).toBeGreaterThanOrEqual(24);
    expect(libraryScenarios.length).toBeLessThanOrEqual(28);
    expect(contracts.map((scenario) => scenario.id)).toEqual([
      "contract-fixed-line", "contract-quantity-line", "contract-section-assignment", "contract-multi-paragraph-facts", "contract-mixed-batches",
    ]);
    expect(scenarios).toHaveLength(31);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);
    for (const scenario of scenarios) {
      expect(scenario.version).toBeGreaterThan(0);
      expect(scenario.review.inputs).toBe("pending");
      expect(scenario.review.expectations).toBe("pending");
      expect(scenario.review.provider).toBe("blocked");
      expect(scenario.history).toEqual([]); // The runner can seed only real Quote state, not invented prior conversation.
      expect(scenario.steps.every((step) => step.assertions.length > 0)).toBe(true);
      if (scenario.suite === "contract") {
        expect(scenario.provenance.kind).toBe("synthetic-contract");
        expect(scenario.steps[0].assertions).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: "outcome", category: "contract", expected: "committed" }),
          expect.objectContaining({ path: "failedCalls", category: "contract", expected: 0 }),
        ]));
      }
      expect(scenario.expectedQuote).toBeDefined();
      expect(scenario.expectedCalculation).toBeDefined();
      const finalAssertions = scenario.steps.at(-1)!.assertions;
      expect(finalAssertions).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "calculation.subtotal", expected: scenario.expectedCalculation?.subtotal }),
        expect.objectContaining({ path: "calculation.complete", expected: scenario.expectedCalculation?.complete }),
        expect.objectContaining({ path: "calculation.missing", expected: scenario.expectedCalculation?.missing }),
        expect.objectContaining({ path: "calculation.errors", expected: scenario.expectedCalculation?.errors }),
      ]));
      expect(finalAssertions.filter((assertion) => /^calculation\.lines\[\d+\]\.amount$/.test(assertion.path)).length).toBeGreaterThanOrEqual(scenario.expectedCalculation!.lines.length);
      expect(finalAssertions.filter((assertion) => /^calculation\.sections\[\d+\]\.subtotal$/.test(assertion.path)).length).toBeGreaterThanOrEqual(scenario.expectedCalculation!.sections.length);
      for (const forbiddenPath of scenario.forbiddenMutations) {
        expect(scenario.steps.some((step) => step.assertions.some((assertion) => assertion.operator === "unchanged" && assertion.path === forbiddenPath))).toBe(true);
      }
    }
  });

  it("starts the first joinery scenario with administrative details but leaves all work to the Artisan's notes", () => {
    const scenario = scenarios[0];
    expect(scenario.id).toBe("joinery-full-reconstruction");
    expect(scenario.version).toBe(2);
    expect(scenario.startingQuote).toEqual({ ...scenario.expectedQuote!, sections: [], lines: [] });
    const step = scenario.steps[0];
    if (step.kind !== "artisan") throw new Error("Expected Artisan job notes");
    expect(step.text).not.toMatch(/ficti[fv]|adaptation|attestées|Remplis le brouillon|\[Zone de travail/);
    expect(step.text.length).toBeLessThan(8000);
    // Equivalent professional headings are acceptable; group order and line allocation still matter.
    const reworded = structuredClone(scenario.expectedQuote!);
    reworded.sections.forEach((section, index) => { section.title = `Zone ${String.fromCharCode(65 + index)}`; });
    expect(evaluateAssertions(step.assertions, scenario.startingQuote, reworded, "committed", 0).filter(result => !result.passed)).toEqual([]);
  });

  it("retains the three source-derived reconstructions and independently supplied totals", () => {
    const joinery = scenarios.find((scenario) => scenario.id === "joinery-full-reconstruction");
    const landscape = scenarios.find((scenario) => scenario.id === "landscape-full-reconstruction");
    const civil = scenarios.find((scenario) => scenario.id === "civil-full-reconstruction");

    expect(joinery?.expectedQuote?.sections).toHaveLength(7);
    expect(joinery?.expectedQuote?.lines).toHaveLength(30);
    expect(joinery?.steps[0].assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "calculation.subtotal", expected: 2_685_430 }),
      expect.objectContaining({ path: "calculation.vat", expected: 217_520 }),
      expect.objectContaining({ path: "calculation.total", expected: 2_902_950 }),
      expect.objectContaining({ path: "calculation.complete", expected: true }),
      expect.objectContaining({ path: "calculation.missing", expected: [] }),
      expect.objectContaining({ path: "calculation.errors", expected: [] }),
    ]));
    expect(joinery?.steps[0].assertions.some((assertion) => assertion.path.includes("description") && assertion.operator === "equals")).toBe(false);
    expect(joinery?.humanReview.some((item) => item.includes("descriptions"))).toBe(true);
    expect(landscape?.expectedQuote?.lines).toHaveLength(14);
    expect(landscape?.steps[0].assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "calculation.total", expected: 1_624_959 }),
    ]));
    expect(civil?.expectedQuote?.lines).toHaveLength(17);
    expect(civil?.steps[0].assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "calculation.total", expected: 1_006_573 }),
    ]));
    const joineryScenarios = scenarios.filter((scenario) => scenario.profession === "joinery");
    expect(joineryScenarios.length).toBeGreaterThan(scenarios.length / 2);
    expect(joineryScenarios.filter((scenario) => scenario.provenance.alias === "joinery-cladding-reference").length).toBeGreaterThan(joineryScenarios.length / 2);
    expect(joineryScenarios.some((scenario) => scenario.provenance.kind === "synthetic-edge" && scenario.id.includes("half-up"))).toBe(true);
  });

  it("accepts independently constructed expected states for source reconstruction, copying, incomplete capture, and stale rollback", () => {
    const byId = (id: string) => scenarios.find((scenario) => scenario.id === id)!;
    const reconstruction = byId("joinery-full-reconstruction");
    expect(evaluateAssertions(reconstruction.steps[0].assertions, reconstruction.startingQuote, reconstruction.expectedQuote!, "committed", 0).every((result) => result.passed)).toBe(true);

    const copy = byId("joinery-copy-section");
    expect(copy.expectedQuote?.sections.map((section) => section.title)).toEqual(["Zone A", "Zone A annexe", "Zone B"]);
    expect(copy.expectedQuote?.lines.map((line) => line.sectionId)).toEqual(["a", "copy", "b"]);
    const copyAfter = structuredClone(copy.startingQuote);
    copyAfter.sections.splice(1, 0, { id: "copy", title: "Zone A annexe" });
    copyAfter.lines = [copyAfter.lines[0], { ...copyAfter.lines[0], id: "copied", sectionId: "copy" }, copyAfter.lines[1]];
    expect(evaluateAssertions(copy.steps[0].assertions, copy.startingQuote, copyAfter, "committed", 0).every((result) => result.passed)).toBe(true);

    const incomplete = byId("joinery-uncertain-unit-clarification");
    const incompleteAfter = structuredClone(incomplete.startingQuote);
    incompleteAfter.lines = [{ id: "line", sectionId: "", description: "Ossature bois", mode: "quantity", quantity: "12.500", unit: "", unitPrice: "40.00", amount: "" }];
    expect(evaluateAssertions(incomplete.steps[0].assertions, incomplete.startingQuote, incompleteAfter, "committed", 0).every((result) => result.passed)).toBe(true);

    expect(incomplete.expectedQuote?.lines[0]).toMatchObject({ quantity: "12.500", unit: "ml", unitPrice: "40.00" });
    const manualFallback = byId("joinery-manual-fallback-all-work");
    expect(manualFallback.expectedQuote).toMatchObject({ sections: [], lines: [] });

    const stale = byId("joinery-stale-turn-rollback");
    const staleStep = stale.steps[0];
    if (staleStep.kind !== "artisan" || !staleStep.concurrentManualQuote) throw new Error("stale scenario must script a concurrent manual save");
    expect(evaluateAssertions(staleStep.assertions, stale.startingQuote, staleStep.concurrentManualQuote, "stale", 0).every((result) => result.passed)).toBe(true);

    const zero = byId("joinery-zero-is-not-missing");
    expect(evaluateAssertions(zero.steps[0].assertions, zero.startingQuote, zero.startingQuote, "assistant_invalid_response", 0).every((result) => result.passed)).toBe(true);

    const bulk = byId("joinery-bulk-percent-price-adjustment");
    const bulkAfter = structuredClone(bulk.startingQuote);
    bulkAfter.lines[0].unitPrice = "71.10";
    bulkAfter.lines[1].unitPrice = "71.10";
    expect(evaluateAssertions(bulk.steps[0].assertions, bulk.startingQuote, bulkAfter, "committed", 0).every((result) => result.passed)).toBe(true);
  });

  it("agrees with every independently authored final commercial calculation", () => {
    for (const scenario of scenarios) {
      const assertions = scenario.steps.at(-1)!.assertions.filter(assertion => assertion.path.startsWith("calculation."));
      const failures = evaluateAssertions(assertions, scenario.startingQuote, scenario.expectedQuote!, "committed", 0).filter(result => !result.passed);
      expect(failures, scenario.id).toEqual([]);
    }
  });

  it("covers clarification, manual-only fallback, ordering, arithmetic, safety, and both languages", () => {
    const ids = scenarios.map((scenario) => scenario.id).join(" ");
    expect(ids).toMatch(/clarification/);
    expect(ids).toMatch(/manual-fallback/);
    expect(ids).toMatch(/copy/);
    expect(ids).toMatch(/order/);
    expect(ids).toMatch(/half-up/);
    expect(ids).toMatch(/injection/);
    expect(scenarios.some((scenario) => scenario.locale === "fr")).toBe(true);
    expect(scenarios.some((scenario) => scenario.locale === "en")).toBe(true);
  });
});
