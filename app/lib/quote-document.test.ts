import { describe, expect, it } from "vitest";

import { firstQuoteExample } from "./first-quote-examples";
import { calculateQuote } from "./quote";
import { quoteDocumentContent } from "./quote-document";

function published(revisionNumber: number, quote = firstQuoteExample("civil-works-reference")) {
  return quoteDocumentContent({ kind: "published", revisionNumber, quote, calculation: calculateQuote(quote) });
}

describe("Quote Document content", () => {
  it("names a Published Revision's file with its revision number but labels the document only from revision 2", () => {
    expect(published(1)).toMatchObject({ filename: "Devis-EX-2026-092-r1.pdf", revisionLabel: null, draft: false });
    expect(published(2)).toMatchObject({ filename: "Devis-EX-2026-092-r2.pdf", revisionLabel: "Révision 2" });
  });

  it("lists work by section with Quote Lines numbered across sections, fixed prices without quantities, and VAT totals", () => {
    const content = published(1);
    expect(content.groups.map((group) => [group.title?.text, group.subtotal?.text, group.lines.length])).toEqual([
      ["Installation", "1\u2019040.00", 2],
      ["Travaux de fouille eaux us\u00e9es", "4\u2019449.00", 8],
      ["Travaux de fouille eaux claires", "3\u2019822.50", 7],
    ]);
    expect(content.groups[0].lines[0]).toMatchObject({ number: "1", pricing: { kind: "fixed" }, amount: { text: "800.00", missing: false } });
    expect(content.groups[0].lines[0].description.text).toMatch(/^Installation de chantier comprenant/);
    expect(content.groups[1].lines[0]).toMatchObject({
      number: "3",
      pricing: { kind: "quantity", quantity: { text: "9.5" }, unit: { text: "m3" }, unitPrice: { text: "114.00" } },
      amount: { text: "1\u2019083.00" },
    });
    expect(content.groups[2].lines.at(-1)?.number).toBe("17");
    expect(content.totals).toEqual([
      { label: "Sous-total HT", amount: { text: "9\u2019311.50", missing: false }, grand: false },
      { label: "TVA 8,1 %", amount: { text: "754.23", missing: false }, grand: false },
      { label: "Total CHF", amount: { text: "10\u2019065.73", missing: false }, grand: true },
    ]);
  });

  it("shows the amounts frozen with a Published Revision instead of recalculating them", () => {
    const quote = firstQuoteExample("civil-works-reference");
    const stored = calculateQuote(quote);
    // An amount calculated under earlier rules must still print as published.
    const calculation = { ...stored, vat: 71_700, total: 1_002_850, lines: stored.lines.map((line) => line.id === "line-1-1" ? { ...line, amount: 80_005 } : line) };
    const content = quoteDocumentContent({ kind: "published", revisionNumber: 1, quote, calculation });
    expect(content.groups[0].lines[0].amount.text).toBe("800.05");
    expect(content.totals.map((total) => total.amount.text)).toEqual(["9\u2019311.50", "717.00", "10\u2019028.50"]);
  });

  it("shows missing values in a Draft Preview as \u00e0 compl\u00e9ter and never prints an incomplete total as CHF 0.00", () => {
    const content = quoteDocumentContent({ kind: "draft", quote: {
      ...firstQuoteExample("civil-works-reference"),
      vatRegistered: null,
      sections: [{ id: "section-1", title: "" }],
      lines: [
        { id: "a", sectionId: "section-1", description: "Creuse", mode: "quantity", quantity: "", unit: "m3", unitPrice: "114", amount: "" },
        { id: "b", sectionId: "section-1", description: "", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "" },
      ],
    } });
    const missing = { text: "\u00e0 compl\u00e9ter", missing: true };
    expect(content.groups[0]).toMatchObject({ title: missing, subtotal: missing });
    expect(content.groups[0].lines[0]).toMatchObject({ pricing: { quantity: missing, unit: { text: "m3" }, unitPrice: { text: "114.00" } }, amount: missing });
    expect(content.groups[0].lines[1]).toMatchObject({ description: missing, amount: missing });
    expect(content.totals).toEqual([
      { label: "Sous-total HT", amount: missing, grand: false },
      { label: "TVA", amount: missing, grand: false },
      { label: "Total CHF", amount: missing, grand: true },
    ]);
    const unsetDiscount = quoteDocumentContent({ kind: "draft", quote: { ...firstQuoteExample("civil-works-reference"), discountMode: "percent", discount: "" } });
    expect(unsetDiscount.totals).toContainEqual({ label: "Remise", amount: missing, grand: false });
  });

  it("shows a Quote Discount before the total and no VAT row when the business is not VAT-registered", () => {
    const quote = {
      ...firstQuoteExample("civil-works-reference"),
      vatRegistered: false, vatId: "", sections: [], discountMode: "percent" as const, discount: "10",
      lines: [{ id: "a", sectionId: "", description: "Forfait pose", mode: "fixed" as const, quantity: "", unit: "", unitPrice: "", amount: "1000" }],
    };
    expect(published(1, quote).totals.map((total) => [total.label, total.amount.text])).toEqual([
      ["Sous-total HT", "1\u2019000.00"], ["Remise 10 %", "\u2212 100.00"], ["Total CHF", "900.00"],
    ]);
    expect(published(1, { ...quote, discountMode: "fixed", discount: "250" }).totals.map((total) => [total.label, total.amount.text])).toEqual([
      ["Sous-total HT", "1\u2019000.00"], ["Remise", "\u2212 250.00"], ["Total CHF", "750.00"],
    ]);
  });

  it("carries the Quote's details, parties, dates and terms in Swiss French formatting", () => {
    const quote = { ...firstQuoteExample("civil-works-reference"), validUntil: "2026-09-30", siteAddress: "Chemin Exemple 4\n1000 Exemple", customerContact: "M. Exemple" };
    expect(published(2, quote)).toMatchObject({
      reference: { text: "EX-2026-092" },
      issueDate: { text: "15.08.2026" },
      validity: "Offre valable jusqu\u2019au 30.09.2026.",
      title: { text: quote.title },
      siteAddress: "Chemin Exemple 4\n1000 Exemple",
      business: { name: { text: "Terrassement Exemple S\u00e0rl" }, address: { text: "Rue Exemple 2, 1000 Exemple" }, contact: "bureau@example.test", vatId: "CHE-000.000.000 TVA (identifiant fictif d\u2019exemple)" },
      customer: { name: { text: "Atelier Exemple SA" }, address: { text: "Rue Exemple 9, 1000 Exemple" }, contact: "M. Exemple" },
      terms: quote.terms,
    });
    expect(published(1, { ...quote, vatRegistered: false, validUntil: "", siteAddress: "", terms: "" })).toMatchObject({ validity: null, siteAddress: null, terms: null, business: { vatId: null } });
    const missing = { text: "\u00e0 compl\u00e9ter", missing: true };
    expect(quoteDocumentContent({ kind: "draft", quote: { ...quote, reference: "", issueDate: "", customerName: "", customerAddress: "" } })).toMatchObject({
      reference: missing, issueDate: missing, customer: { name: missing, address: missing },
    });
  });

  it("marks a Draft Preview as a draft and names its file without a revision number", () => {
    const quote = firstQuoteExample("civil-works-reference");
    expect(quoteDocumentContent({ kind: "draft", quote })).toMatchObject({ filename: "Devis-EX-2026-092-brouillon.pdf", revisionLabel: null, draft: true });
    expect(quoteDocumentContent({ kind: "draft", quote: { ...quote, reference: "" } }).filename).toBe("Devis-brouillon.pdf");
    expect(quoteDocumentContent({ kind: "draft", quote: { ...quote, reference: "Chantier/Épalinges 3" } }).filename).toBe("Devis-Chantier-Epalinges-3-brouillon.pdf");
  });
});
