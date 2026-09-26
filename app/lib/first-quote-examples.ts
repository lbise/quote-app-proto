import { readFileSync } from "node:fs";

import { emptyQuote, type QuoteData } from "./quote";

/** Anonymized example Quotes from docs/examples/first-quotes, for tests only. */
export const firstQuoteExampleNames = ["landscape-reference", "civil-works-reference", "joinery-reference"] as const;
export type FirstQuoteExampleName = (typeof firstQuoteExampleNames)[number];

export function firstQuoteExample(name: FirstQuoteExampleName): QuoteData {
  return quoteFromExample(JSON.parse(readFileSync(new URL(`../../docs/examples/first-quotes/${name}.json`, import.meta.url), "utf8")));
}

// The fixtures use a documentation format, not the production Quote schema.
export function quoteFromExample(example: any): QuoteData {
  const snapshot = example.quoteSnapshot;
  return {
    ...emptyQuote(snapshot.reference),
    title: example.title,
    issueDate: snapshot.issueDate,
    customerName: snapshot.customer.name,
    customerAddress: snapshot.customer.address,
    businessName: snapshot.issuer.name,
    businessAddress: snapshot.issuer.address,
    businessContact: snapshot.issuer.email,
    vatId: snapshot.issuer.vatIdentifier,
    vatRegistered: snapshot.tax.mode === "vat",
    terms: Array.isArray(snapshot.terms) ? snapshot.terms.join("\n") : "",
    sections: example.sections.map((section: any, index: number) => ({ id: `section-${index + 1}`, title: section.name })),
    lines: example.sections.flatMap((section: any, sectionIndex: number) => section.lines.map((line: any, lineIndex: number) => ({
      id: `line-${sectionIndex + 1}-${lineIndex + 1}`,
      sectionId: `section-${sectionIndex + 1}`,
      description: line.description,
      mode: line.kind === "fixed" ? "fixed" : "quantity",
      quantity: line.quantity ?? "",
      unit: line.unit ?? "",
      unitPrice: line.unitPrice ?? "",
      amount: line.amount,
    }))),
  };
}
