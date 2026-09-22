import { describe, expect, it } from "vitest";

import { emptyQuote } from "../app/lib/quote";
import { evaluateAssertions, projectQuote } from "./assertions";

function quote() {
  return {
    ...emptyQuote("EQ-1"),
    discount: "01,00",
    sections: [{ id: "section-a", title: "First" }, { id: "section-b", title: "Second" }],
    lines: [
      { id: "line-a", sectionId: "section-b", description: "Work", mode: "quantity" as const, quantity: "002.500", unit: "m2", unitPrice: "01,20", amount: "" },
      { id: "line-b", sectionId: "", description: "Fixed", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "000.50" },
    ],
  };
}

describe("projectQuote", () => {
  it("removes generated IDs, makes section membership stable, and normalizes numeric strings", () => {
    expect(projectQuote(quote())).toMatchObject({
      discount: "1",
      sections: [{ title: "First" }, { title: "Second" }],
      lines: [
        { sectionId: 1, quantity: "2.5", unitPrice: "1.2", amount: "" },
        { sectionId: -1, amount: "0.5" },
      ],
    });
    expect(projectQuote(quote()).lines.map((line) => line.description)).toEqual(["Work", "Fixed"]);
  });
});

describe("evaluateAssertions", () => {
  it("evaluates projected quote, calculation, outcome, failed calls, and before-state assertions", () => {
    const before = quote();
    const after = { ...quote(), title: "Changed", lines: quote().lines.map((line, index) => index ? { ...line, amount: "0.50" } : line) };
    const results = evaluateAssertions([
      { label: "stable section index", path: "quote.lines[0].sectionId", operator: "equals", expected: 1 },
      { label: "line count", path: "quote.lines.length", operator: "equals", expected: 2 },
      { label: "computed amount", path: "calculation.lines[1].amount", operator: "equals", expected: 300 },
      { label: "message outcome", path: "outcome", operator: "contains", expected: "committed" },
      { label: "failed calls", path: "failedCalls", operator: "equals", expected: 1 },
      { label: "title changed", path: "quote.title", operator: "unchanged" },
      { label: "second line unchanged", path: "quote.lines[1].amount", operator: "unchanged" },
    ], before, after, "committed_with_failed_calls", 1);

    expect(results.map(({ label, passed }) => [label, passed])).toEqual([
      ["stable section index", true],
      ["line count", true],
      ["computed amount", true],
      ["message outcome", true],
      ["failed calls", true],
      ["title changed", false],
      ["second line unchanged", true],
    ]);
  });

  it("accepts declared equivalent unit spellings without accepting a different physical unit", () => {
    const assertions = [{ label: "square metres", path: "quote.lines[0].unit", operator: "oneOf" as const, expected: ["m2", "m²"] }];
    const before = quote();
    for (const [unit, passed] of [["m2", true], ["m²", true], ["m", false], ["", false]] as const) {
      const after = { ...before, lines: before.lines.map((line, index) => index ? line : { ...line, unit }) };
      expect(evaluateAssertions(assertions, before, after, "committed", 0)[0].passed).toBe(passed);
    }
    expect(evaluateAssertions([{ ...assertions[0], expected: "m2" }], before, before, "committed", 0)[0].passed).toBe(false);
    expect(evaluateAssertions([{ ...assertions[0], expected: [] }], before, before, "committed", 0)[0].passed).toBe(false);
  });

  it("reports the normalized before value for unchanged assertions", () => {
    const results = evaluateAssertions([
      { label: "prior amount", path: "quote.lines[1].amount", operator: "unchanged" },
    ], quote(), quote(), "unchanged", 0);

    expect(results[0]).toMatchObject({ passed: true, expected: "0.5", actual: "0.5" });
  });

  it("compares object keys independently of insertion order without normalizing ordinary strings", () => {
    const results = evaluateAssertions([
      { label: "same object", path: "calculation.missing", operator: "contains", expected: { code: "required", path: "customerName" } },
      { label: "title is not a numeric field", path: "quote.title", operator: "equals", expected: "1" },
    ], { ...quote(), title: "001" }, { ...quote(), title: "001" }, "unchanged", 0);

    expect(results.map((result) => result.passed)).toEqual([true, false]);
  });

  it("fails closed for absent paths, missing expectations, and unsupported contains values", () => {
    const results = evaluateAssertions([
      { label: "missing path", path: "quote.lines[8].amount", operator: "equals", expected: "1" },
      { label: "missing expected", path: "outcome", operator: "equals" },
      { label: "wrong contains", path: "failedCalls", operator: "contains", expected: 0 },
    ], quote(), quote(), "unchanged", 0);

    expect(results.map(({ passed, actual }) => [passed, actual])).toEqual([
      [false, undefined],
      [false, "unchanged"],
      [false, 0],
    ]);
  });
});
