import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { calculateQuote, emptyQuote, lineCents, money, publicationMissing, totals } from "./quote";

function completeQuote() {
  return {
    ...emptyQuote("DQ-2026-001"),
    title: "Travaux de menuiserie",
    customerName: "Maison Exemple SA",
    customerAddress: "Rue Exemple 8\n1000 Exemple",
    businessName: "Atelier Exemple Sàrl",
    businessAddress: "Rue Exemple 1\n1000 Exemple",
    businessContact: "bonjour@example.test",
    vatRegistered: true as const,
    vatId: "CHE-000.000.000 TVA",
    issueDate: "2026-09-01",
  };
}

describe("calculateQuote", () => {
  it("calculates the agreed percentage-discount example with line rounding", () => {
    const result = calculateQuote({
      ...completeQuote(),
      discountMode: "percent",
      discount: "10",
      lines: [
        {
          id: "line-1",
          sectionId: "",
          description: "Découpe",
          mode: "quantity",
          quantity: "0.125",
          unit: "h",
          unitPrice: "80.20",
          amount: "",
        },
        {
          id: "line-2",
          sectionId: "",
          description: "Fourniture",
          mode: "quantity",
          quantity: "2",
          unit: "pce",
          unitPrice: "45,50",
          amount: "",
        },
        {
          id: "line-3",
          sectionId: "",
          description: "Forfait",
          mode: "fixed",
          quantity: "",
          unit: "",
          unitPrice: "",
          amount: "25.00",
        },
      ],
    });

    expect(result).toMatchObject({
      errors: [],
      missing: [],
      lines: [
        { id: "line-1", number: 1, amount: 1003 },
        { id: "line-2", number: 2, amount: 9100 },
        { id: "line-3", number: 3, amount: 2500 },
      ],
      sections: [],
      subtotal: 12603,
      discount: 1260,
      net: 11343,
      vat: 919,
      total: 12262,
      complete: true,
    });
  });

  it("keeps flat lines while sections exist and normalizes document order for calculation and snapshots", () => {
    const result = calculateQuote({
      ...completeQuote(),
      sections: [
        { id: "section-b", title: "Deuxième section" },
        { id: "section-a", title: "Première section" },
      ],
      lines: [
        { id: "a-1", sectionId: "section-a", description: "A un", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "1.00" },
        { id: "flat-1", sectionId: "", description: "Sans section un", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "5.00" },
        { id: "b-1", sectionId: "section-b", description: "B un", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "2.00" },
        { id: "a-2", sectionId: "section-a", description: "A deux", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "3.00" },
        { id: "flat-2", sectionId: "", description: "Sans section deux", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "6.00" },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      { id: "flat-1", number: 1, amount: 500 },
      { id: "flat-2", number: 2, amount: 600 },
      { id: "b-1", number: 3, amount: 200 },
      { id: "a-1", number: 4, amount: 100 },
      { id: "a-2", number: 5, amount: 300 },
    ]);
    expect(result.sections).toEqual([
      { id: "section-b", subtotal: 200, incomplete: false },
      { id: "section-a", subtotal: 400, incomplete: false },
    ]);
    expect(result.quote?.lines.map((line) => line.id)).toEqual(["flat-1", "flat-2", "b-1", "a-1", "a-2"]);
  });

  it("rejects a nonempty section ID that has no named Quote Section", () => {
    const result = calculateQuote({
      ...completeQuote(),
      sections: [{ id: "known", title: "Connue" }],
      lines: [
        { id: "orphan", sectionId: "unknown", description: "Orpheline", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "2.00" },
        { id: "flat", sectionId: "", description: "Sans section", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "1.00" },
      ],
    });

    expect(result.quote?.lines.map((line) => line.id)).toEqual(["flat", "orphan"]);
    expect(result.errors).toEqual([{ path: "lines[1].sectionId", code: "unknown_section" }]);
    expect(result.lines).toEqual([
      { id: "flat", number: 1, amount: 100 },
      { id: "orphan", number: 2, amount: null },
    ]);
    expect(result.total).toBeNull();
  });

  it("numbers lines in document order and keeps section subtotals before the discount", () => {
    const result = calculateQuote({
      ...completeQuote(),
      discountMode: "fixed",
      discount: "5.00",
      sections: [
        { id: "installation", title: "Installation" },
        { id: "fouille", title: "Fouille" },
      ],
      lines: [
        {
          id: "line-2", sectionId: "fouille", description: "Fouille", mode: "fixed",
          quantity: "", unit: "", unitPrice: "", amount: "20.00",
        },
        {
          id: "line-1", sectionId: "installation", description: "Installation", mode: "fixed",
          quantity: "", unit: "", unitPrice: "", amount: "10.00",
        },
      ],
    });

    expect(result.lines).toEqual([
      { id: "line-1", number: 1, amount: 1000 },
      { id: "line-2", number: 2, amount: 2000 },
    ]);
    expect(result.sections).toEqual([
      { id: "installation", subtotal: 1000, incomplete: false },
      { id: "fouille", subtotal: 2000, incomplete: false },
    ]);
    expect(result).toMatchObject({ subtotal: 3000, discount: 500, net: 2500, vat: 203, total: 2703 });
  });

  it("shows a partial subtotal but withholds downstream totals for an unpriced Working Draft line", () => {
    const result = calculateQuote({
      ...completeQuote(),
      sections: [{ id: "work", title: "Travaux" }],
      lines: [
        {
          id: "priced", sectionId: "work", description: "Pose", mode: "fixed",
          quantity: "", unit: "", unitPrice: "", amount: "25.00",
        },
        {
          id: "unpriced", sectionId: "work", description: "Mesure à confirmer", mode: "quantity",
          quantity: "", unit: "m", unitPrice: "", amount: "",
        },
      ],
    });

    expect(result.lines).toEqual([
      { id: "priced", number: 1, amount: 2500 },
      { id: "unpriced", number: 2, amount: null },
    ]);
    expect(result.sections).toEqual([{ id: "work", subtotal: 2500, incomplete: true }]);
    expect(result).toMatchObject({
      subtotal: 2500,
      discount: null,
      net: null,
      vat: null,
      total: null,
      complete: false,
      errors: [],
      missing: [
        { path: "lines[1].quantity", code: "required" },
        { path: "lines[1].unitPrice", code: "required" },
      ],
    });
  });

  it("keeps valid arithmetic available when only publication details are missing", () => {
    const quote = {
      ...completeQuote(),
      customerName: "",
      customerAddress: "",
      vatRegistered: false as const,
      vatId: "",
      lines: [
        {
          id: "line-1", sectionId: "", description: "Forfait", mode: "fixed" as const,
          quantity: "", unit: "", unitPrice: "", amount: "12.34",
        },
      ],
    };
    const result = calculateQuote(quote);

    expect(result).toMatchObject({
      errors: [],
      missing: [
        { path: "customerName", code: "required" },
        { path: "customerAddress", code: "required" },
      ],
      subtotal: 1234,
      discount: 0,
      net: 1234,
      vat: null,
      total: 1234,
      complete: false,
    });
    expect(totals(quote)).toEqual({ subtotal: 1234, discount: 0, net: 1234, vat: null, total: 1234, incomplete: 0 });
    expect(publicationMissing(quote)).toBe(true);
  });

  it("distinguishes explicit unregistered VAT from unknown VAT registration", () => {
    const base = {
      ...completeQuote(),
      lines: [
        {
          id: "line-1", sectionId: "", description: "Forfait", mode: "fixed" as const,
          quantity: "", unit: "", unitPrice: "", amount: "100.00",
        },
      ],
    };

    expect(calculateQuote({ ...base, vatRegistered: false, vatId: "" })).toMatchObject({
      errors: [], missing: [], vat: null, total: 10000, complete: true,
    });
    expect(calculateQuote({ ...base, vatRegistered: null, vatId: "" })).toMatchObject({
      errors: [],
      missing: [{ path: "vatRegistered", code: "required" }],
      vat: null,
      total: null,
      complete: false,
    });
  });

  it("reports invalid values separately from missing draft values", () => {
    const result = calculateQuote({
      ...completeQuote(),
      discountMode: "percent",
      discount: "100.001",
      lines: [
        {
          id: "line-1", sectionId: "", description: "Mesure", mode: "quantity",
          quantity: "0", unit: "", unitPrice: "-1.000", amount: "",
        },
      ],
    });

    expect(result.quote).not.toBeNull();
    expect(result.errors).toEqual([
      { path: "lines[0].unitPrice", code: "negative_value" },
      { path: "lines[0].quantity", code: "must_be_positive" },
      { path: "discount", code: "unsupported_precision" },
    ]);
    expect(result.missing).toEqual([{ path: "lines[0].unit", code: "required" }]);
    expect(result).toMatchObject({ subtotal: 0, discount: null, net: null, vat: null, total: null, complete: false });
  });

  it("validates supplied pricing values even when a draft line lacks its description", () => {
    const result = calculateQuote({
      ...completeQuote(),
      lines: [
        {
          id: "quantity", sectionId: "", description: "", mode: "quantity",
          quantity: "-5", unit: "h", unitPrice: "20.000", amount: "",
        },
        {
          id: "fixed", sectionId: "", description: "", mode: "fixed",
          quantity: "1", unit: "pce", unitPrice: "2.00", amount: "-20.00",
        },
      ],
    });

    expect(result.errors).toEqual([
      { path: "lines[0].quantity", code: "negative_value" },
      { path: "lines[0].unitPrice", code: "unsupported_precision" },
      { path: "lines[1].quantity", code: "inapplicable" },
      { path: "lines[1].unit", code: "inapplicable" },
      { path: "lines[1].unitPrice", code: "inapplicable" },
      { path: "lines[1].amount", code: "negative_value" },
    ]);
    expect(result.missing).toEqual([
      { path: "lines[0].description", code: "required" },
      { path: "lines[1].description", code: "required" },
    ]);
    expect(result.lines).toEqual([
      { id: "quantity", number: 1, amount: null },
      { id: "fixed", number: 2, amount: null },
    ]);
  });

  it("rejects malformed structures without throwing", () => {
    expect(calculateQuote({ lines: "not an array" })).toEqual({
      quote: null,
      errors: [{ path: "reference", code: "invalid_type" }],
      missing: [],
      lines: [],
      sections: [],
      subtotal: 0,
      discount: null,
      net: null,
      vat: null,
      total: null,
      complete: false,
    });
  });

  it("uses the independently checked adapted landscape and civil-works totals", () => {
    const landscape = JSON.parse(readFileSync(new URL("../../docs/examples/first-quotes/landscape-reference.json", import.meta.url), "utf8"));
    const civilWorks = JSON.parse(readFileSync(new URL("../../docs/examples/first-quotes/civil-works-reference.json", import.meta.url), "utf8"));

    expect(calculateQuote(referenceQuote(landscape))).toMatchObject({
      errors: [], missing: [], subtotal: 1_503_200, discount: 0, net: 1_503_200, vat: 121_759, total: 1_624_959, complete: true,
      sections: [
        { id: "section-1", subtotal: 1_296_200, incomplete: false },
        { id: "section-2", subtotal: 207_000, incomplete: false },
      ],
    });
    expect(calculateQuote(referenceQuote(civilWorks))).toMatchObject({
      errors: [], missing: [], subtotal: 931_150, discount: 0, net: 931_150, vat: 75_423, total: 1_006_573, complete: true,
      sections: [
        { id: "section-1", subtotal: 104_000, incomplete: false },
        { id: "section-2", subtotal: 444_900, incomplete: false },
        { id: "section-3", subtotal: 382_250, incomplete: false },
      ],
    });
  });

  it("uses every independently checked line and section amount from the long joinery fixture", () => {
    const joinery = JSON.parse(readFileSync(new URL("../../docs/examples/first-quotes/joinery-reference.json", import.meta.url), "utf8"));
    const result = calculateQuote(referenceQuote(joinery));

    expect(result.errors).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.quote).toMatchObject({
      reference: "JNR-2026-014",
      title: "Bardage et menuiserie. Exemple adapté",
      terms: "",
      issueDate: "2026-08-15",
      customerName: "Habitat Echantillon SA",
      businessName: "Atelier Exemple Sàrl",
    });
    expect(result.lines).toEqual([
      { id: "line-1-1", number: 1, amount: 120_000 },
      { id: "line-1-2", number: 2, amount: 480_000 },
      { id: "line-1-3", number: 3, amount: 190_000 },
      { id: "line-1-4", number: 4, amount: 70_000 },
      { id: "line-1-5", number: 5, amount: 189_900 },
      { id: "line-1-6", number: 6, amount: 120_000 },
      { id: "line-1-7", number: 7, amount: 333_380 },
      { id: "line-2-1", number: 8, amount: 33_280 },
      { id: "line-2-2", number: 9, amount: 63_200 },
      { id: "line-3-1", number: 10, amount: 38_000 },
      { id: "line-3-2", number: 11, amount: 18_000 },
      { id: "line-3-3", number: 12, amount: 75_770 },
      { id: "line-3-4", number: 13, amount: 24_000 },
      { id: "line-3-5", number: 14, amount: 138_250 },
      { id: "line-4-1", number: 15, amount: 38_000 },
      { id: "line-4-2", number: 16, amount: 11_200 },
      { id: "line-4-3", number: 17, amount: 23_710 },
      { id: "line-4-4", number: 18, amount: 24_000 },
      { id: "line-4-5", number: 19, amount: 37_130 },
      { id: "line-5-1", number: 20, amount: 76_000 },
      { id: "line-5-2", number: 21, amount: 12_800 },
      { id: "line-5-3", number: 22, amount: 131_280 },
      { id: "line-5-4", number: 23, amount: 48_000 },
      { id: "line-5-5", number: 24, amount: 242_530 },
      { id: "line-6-1", number: 25, amount: 15_000 },
      { id: "line-6-2", number: 26, amount: 25_690 },
      { id: "line-6-3", number: 27, amount: 37_130 },
      { id: "line-7-1", number: 28, amount: 15_000 },
      { id: "line-7-2", number: 29, amount: 22_580 },
      { id: "line-7-3", number: 30, amount: 31_600 },
    ]);
    expect(result.sections).toEqual([
      { id: "section-1", subtotal: 1_503_280, incomplete: false },
      { id: "section-2", subtotal: 96_480, incomplete: false },
      { id: "section-3", subtotal: 294_020, incomplete: false },
      { id: "section-4", subtotal: 134_040, incomplete: false },
      { id: "section-5", subtotal: 510_610, incomplete: false },
      { id: "section-6", subtotal: 77_820, incomplete: false },
      { id: "section-7", subtotal: 69_180, incomplete: false },
    ]);
    expect(result).toMatchObject({
      subtotal: 2_685_430,
      discount: 0,
      net: 2_685_430,
      vat: 217_520,
      total: 2_902_950,
      complete: true,
    });
  });

  it("allows zero-priced work and discounts that reduce a Quote to zero", () => {
    const zeroPriced = {
      ...completeQuote(),
      lines: [
        {
          id: "quantity-zero", sectionId: "", description: "Prestation offerte", mode: "quantity" as const,
          quantity: "1.000", unit: "pce", unitPrice: "0.00", amount: "",
        },
        {
          id: "fixed-zero", sectionId: "", description: "Forfait offert", mode: "fixed" as const,
          quantity: "", unit: "", unitPrice: "", amount: "0.00",
        },
      ],
    };
    expect(calculateQuote(zeroPriced)).toMatchObject({
      errors: [], missing: [], subtotal: 0, discount: 0, net: 0, vat: 0, total: 0, complete: true,
    });

    const fullyDiscounted = {
      ...completeQuote(),
      discountMode: "percent" as const,
      discount: "100.00",
      lines: [{
        id: "line", sectionId: "", description: "Forfait", mode: "fixed" as const,
        quantity: "", unit: "", unitPrice: "", amount: "12.34",
      }],
    };
    expect(calculateQuote(fullyDiscounted)).toMatchObject({ subtotal: 1234, discount: 1234, net: 0, vat: 0, total: 0, complete: true });
    expect(calculateQuote({
      ...fullyDiscounted,
      discountMode: "fixed",
      discount: "12.34",
    })).toMatchObject({ subtotal: 1234, discount: 1234, net: 0, vat: 0, total: 0, complete: true });
  });

  it("rejects unsupported precision, negative values, and discounts beyond the complete subtotal", () => {
    const result = calculateQuote({
      ...completeQuote(),
      discountMode: "fixed",
      discount: "60.01",
      lines: [{
        id: "line", sectionId: "", description: "Forfait", mode: "fixed",
        quantity: "", unit: "", unitPrice: "", amount: "60.001",
      }],
    });
    expect(result.errors).toEqual([
      { path: "lines[0].amount", code: "unsupported_precision" },
    ]);
    expect(result.missing).toEqual([]);
    expect(result.total).toBeNull();

    const overDiscount = calculateQuote({
      ...completeQuote(),
      discountMode: "fixed",
      discount: "60.01",
      lines: [{
        id: "line", sectionId: "", description: "Forfait", mode: "fixed",
        quantity: "", unit: "", unitPrice: "", amount: "60.00",
      }],
    });
    expect(overDiscount.errors).toEqual([{ path: "discount", code: "out_of_range" }]);
    expect(overDiscount.total).toBeNull();

    expect(calculateQuote({
      ...completeQuote(),
      discountMode: "percent",
      discount: "100.01",
      lines: [{
        id: "line", sectionId: "", description: "Forfait", mode: "fixed",
        quantity: "", unit: "", unitPrice: "", amount: "60.00",
      }],
    }).errors).toEqual([{ path: "discount", code: "out_of_range" }]);
  });

  it("calculates VAT once on the whole discounted subtotal", () => {
    const result = calculateQuote({
      ...completeQuote(),
      lines: [
        { id: "one", sectionId: "", description: "Un", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "0.06" },
        { id: "two", sectionId: "", description: "Deux", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "0.06" },
      ],
    });
    expect(result).toMatchObject({ subtotal: 12, discount: 0, net: 12, vat: 1, total: 13, complete: true });
  });

  it("rounds each line and VAT once, and formats safe cent values for French CHF", () => {
    const quote = {
      ...completeQuote(),
      lines: [
        {
          id: "one", sectionId: "", description: "Première", mode: "quantity" as const,
          quantity: "0.125", unit: "h", unitPrice: "80.20", amount: "",
        },
        {
          id: "two", sectionId: "", description: "Deuxième", mode: "quantity" as const,
          quantity: "0.125", unit: "h", unitPrice: "80.20", amount: "",
        },
      ],
    };

    expect(calculateQuote(quote)).toMatchObject({ subtotal: 2006, vat: 162, total: 2168 });
    expect(lineCents({ ...quote.lines[0], description: "" })).toBeNull();
    expect(money(123_456_789)).toBe("1\u202f234\u202f567.89\u00a0CHF");
  });
});

function referenceQuote(reference: any) {
  const sections = reference.sections.map((section: any, index: number) => ({ id: `section-${index + 1}`, title: section.name }));
  return {
    ...completeQuote(),
    reference: reference.quoteSnapshot.reference,
    title: reference.title,
    issueDate: reference.quoteSnapshot.issueDate,
    customerName: reference.quoteSnapshot.customer.name,
    customerAddress: reference.quoteSnapshot.customer.address,
    businessName: reference.quoteSnapshot.issuer.name,
    businessAddress: reference.quoteSnapshot.issuer.address,
    businessContact: reference.quoteSnapshot.issuer.email,
    vatId: reference.quoteSnapshot.issuer.vatIdentifier,
    vatRegistered: reference.quoteSnapshot.tax.mode === "vat",
    terms: Array.isArray(reference.quoteSnapshot.terms) ? reference.quoteSnapshot.terms.join("\n") : "",
    sections,
    lines: reference.sections.flatMap((section: any, sectionIndex: number) => section.lines.map((line: any, lineIndex: number) => ({
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
