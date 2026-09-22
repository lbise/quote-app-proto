import { describe, expect, it } from "vitest";

import { assertEvaluationControlUrl } from "./isolation";

describe("evaluation database isolation", () => {
  it("accepts only the dedicated local evaluation template URL", () => {
    expect(assertEvaluationControlUrl("postgresql://quote_evaluation:local@127.0.0.1:55434/quote_evaluation").pathname).toBe("/quote_evaluation");
    expect(() => assertEvaluationControlUrl("postgresql://easy_quote:local@localhost:55432/easy_quote_local")).toThrow(/quote_evaluation/);
    expect(() => assertEvaluationControlUrl("postgresql://quote_evaluation:local@db.example.test/quote_evaluation")).toThrow(/local/);
    expect(() => assertEvaluationControlUrl("postgresql://quote_evaluation:local@localhost/quote_evaluation_case_deadbeef")).toThrow(/quote_evaluation/);
    expect(() => assertEvaluationControlUrl("postgresql://quote_evaluation:local@localhost/quote_evaluation?host=db.example.test&database=production")).toThrow();
  });
});
