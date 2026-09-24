import { calculateQuote, type QuoteData } from "../app/lib/quote";
import type { Assertion, AssertionResult } from "./types";

export type ProjectedQuote = Omit<QuoteData, "sections" | "lines"> & {
  sections: Omit<QuoteData["sections"][number], "id">[];
  lines: (Omit<QuoteData["lines"][number], "id" | "sectionId"> & { sectionId: number })[];
};

/** Removes generated IDs while preserving Quote Section and Quote Line order. */
export function projectQuote(quote: QuoteData): ProjectedQuote {
  const sectionIndex = new Map(quote.sections.map((section, index) => [section.id, index]));
  return {
    ...quote,
    discount: normalizeNumericString(quote.discount),
    sections: quote.sections.map(({ id: _id, ...section }) => section),
    lines: quote.lines.map(({ id: _id, sectionId, quantity, unitPrice, amount, ...line }) => ({
      ...line,
      sectionId: sectionId === "" ? -1 : sectionIndex.get(sectionId) ?? -1,
      quantity: normalizeNumericString(quantity),
      unitPrice: normalizeNumericString(unitPrice),
      amount: normalizeNumericString(amount),
    })),
  };
}

/** Evaluate one turn against stable quote projections and the calculator's public result. */
export function evaluateAssertions(
  assertions: Assertion[],
  before: QuoteData,
  after: QuoteData,
  outcome: string,
  failedCalls: number,
  message = "",
): AssertionResult[] {
  const current = { quote: projectQuote(after), calculation: calculateQuote(after), outcome, failedCalls, message };
  const previous = { quote: projectQuote(before), calculation: calculateQuote(before), outcome, failedCalls, message };

  return assertions.map((assertion) => {
    const actual = readPath(current, assertion.path);
    const prior = readPath(previous, assertion.path);
    const hasExpected = Object.hasOwn(assertion, "expected") && assertion.expected !== undefined;
    const expected = assertion.operator === "unchanged" ? prior.value : assertion.expected;
    const passed = actual.found && (assertion.operator === "unchanged"
      ? prior.found && equal(actual.value, prior.value)
      : hasExpected && (assertion.operator === "oneOf"
        ? Array.isArray(assertion.expected) && assertion.expected.some(value => equal(actual.value, normalizeExpected(assertion.path, value)))
        : evaluate(assertion.operator, actual.value, normalizeExpected(assertion.path, assertion.expected))));
    return { ...(assertion.category ? { category: assertion.category } : {}), label: assertion.label, path: assertion.path, passed, expected, actual: actual.found ? actual.value : undefined };
  });
}

function evaluate(operator: "equals" | "contains", actual: unknown, expected: unknown): boolean {
  return operator === "equals" ? equal(actual, expected) : contains(actual, expected);
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string") return actual.includes(expected);
  if (Array.isArray(actual)) return actual.some((value) => equal(value, expected));
  if (isRecord(actual) && isRecord(expected)) {
    return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && (equal(actual[key], value) || contains(actual[key], value)));
  }
  return false;
}

function equal(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((value, index) => equal(value, expected[index]));
  }
  if (isRecord(actual) && isRecord(expected)) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    return actualKeys.length === expectedKeys.length
      && actualKeys.every((key) => Object.hasOwn(expected, key) && equal(actual[key], expected[key]));
  }
  return false;
}

/** Numeric syntax is semantic only for numeric Quote fields, never for names or prose. */
function normalizeExpected(path: string, value: unknown): unknown {
  return /(?:^|\.)(?:discount|quantity|unitPrice|amount)$/.test(path) && typeof value === "string"
    ? normalizeNumericString(value)
    : value;
}

function normalizeNumericString(value: string): string {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(value.trim());
  if (!match) return value;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function readPath(root: unknown, path: string): { found: boolean; value?: unknown } {
  const tokens = path.match(/[^.\[\]]+/g);
  if (!tokens?.length || tokens.join(".") !== path.replace(/\[(\d+)\]/g, ".$1")) return { found: false };
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (token === "length") { current = current.length; continue; }
      if (!/^\d+$/.test(token)) return { found: false };
      const index = Number(token);
      if (index >= current.length) return { found: false };
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return { found: false };
    }
  }
  return { found: current !== undefined, value: current };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
