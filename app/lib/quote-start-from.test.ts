import { describe, expect, it } from "vitest";

import { calculateQuote, emptyQuote, type QuoteData } from "./quote";
import { parseQuoteSource, quoteSourceName, quoteSourceOptions, workFromSource } from "./quote-start-from";

function source(): QuoteData {
  return {
    ...emptyQuote("Q-12"),
    title: "Cuisine Dupont",
    customerName: "Famille Dupont",
    siteAddress: "Chemin des Vignes 4",
    discountMode: "percent",
    discount: "5",
    sections: [{ id: "section-a", title: "Meubles" }, { id: "section-b", title: "Pose" }],
    lines: [
      { id: "line-1", sectionId: "", description: "Relevé", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
      { id: "line-2", sectionId: "section-a", description: "Façades chêne", mode: "quantity", quantity: "4", unit: "pce", unitPrice: "250.00", amount: "" },
      { id: "line-3", sectionId: "section-b", description: "Montage", mode: "quantity", quantity: "", unit: "h", unitPrice: "95.00", amount: "" },
      { id: "line-4", sectionId: "section-a", description: "Poignées", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "40.00" },
    ],
  };
}

describe("workFromSource", () => {
  it("copies the title, sections and lines in order with new IDs", () => {
    let next = 0;
    const work = workFromSource(source(), (kind) => `${kind}-new-${++next}`);
    expect(work.title).toBe("Cuisine Dupont");
    expect(work.sections).toEqual([{ id: "section-new-1", title: "Meubles" }, { id: "section-new-2", title: "Pose" }]);
    expect(work.lines).toEqual([
      { id: "line-new-3", sectionId: "", description: "Relevé", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "80.00" },
      { id: "line-new-4", sectionId: "section-new-1", description: "Façades chêne", mode: "quantity", quantity: "4", unit: "pce", unitPrice: "250.00", amount: "" },
      { id: "line-new-5", sectionId: "section-new-2", description: "Montage", mode: "quantity", quantity: "", unit: "h", unitPrice: "95.00", amount: "" },
      { id: "line-new-6", sectionId: "section-new-1", description: "Poignées", mode: "fixed", quantity: "", unit: "", unitPrice: "", amount: "40.00" },
    ]);
  });

  it("does not share objects with the source", () => {
    const original = source();
    const work = workFromSource(original, (kind) => `${kind}-${crypto.randomUUID()}`);
    work.lines[0].description = "Changed";
    work.sections[0].title = "Changed";
    expect(original.lines[0].description).toBe("Relevé");
    expect(original.sections[0].title).toBe("Meubles");
  });

  it("copies an empty version", () => {
    expect(workFromSource(emptyQuote("Q-1"), () => "unused")).toEqual({ title: "", sections: [], lines: [] });
  });
});

describe("parseQuoteSource", () => {
  it("accepts the Working Draft or a Published Revision number", () => {
    expect(parseQuoteSource("draft")).toBe("draft");
    expect(parseQuoteSource(2)).toBe(2);
  });

  it("rejects anything else", () => {
    for (const value of [undefined, null, "", "latest", 0, -1, 1.5, "2", {}, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseQuoteSource(value), String(value)).toBeNull();
    }
  });
});

describe("quoteSourceName", () => {
  it("names the version in menus and in the notice, in both languages", () => {
    expect(quoteSourceName("draft", "en", "menu")).toBe("New Quote from the Working Draft");
    expect(quoteSourceName(2, "en", "menu")).toBe("New Quote from Revision 2");
    expect(quoteSourceName("draft", "fr", "menu")).toBe("Nouveau devis à partir du brouillon de travail");
    expect(quoteSourceName(2, "fr", "menu")).toBe("Nouveau devis à partir de la révision 2");
    expect(quoteSourceName("draft", "en", "notice", "Q-12")).toBe("Started from Q-12, Working Draft");
    expect(quoteSourceName(2, "en", "notice", "Q-12")).toBe("Started from Q-12, Revision 2");
    expect(quoteSourceName("draft", "fr", "notice", "Q-12")).toBe("Créé à partir de Q-12, brouillon de travail");
    expect(quoteSourceName(2, "fr", "notice", "Q-12")).toBe("Créé à partir de Q-12, révision 2");
  });
});

describe("quoteSourceOptions", () => {
  const revision = (number: number, publishedAt: string, quote: QuoteData) => ({ number, publishedAt, quote, calculation: calculateQuote(quote) });

  it("lists the Working Draft first, then revisions newest first", () => {
    const draft = { ...source(), lines: source().lines.slice(0, 2) };
    const priced = { ...source(), vatRegistered: false, discountMode: "none" as const };
    const first = { ...priced, lines: [source().lines[0]] };
    const second = { ...priced, lines: [source().lines[0], source().lines[3]] };
    const options = quoteSourceOptions({
      draft, updatedAt: "2026-09-29T10:00:00.000Z",
      revisions: [revision(1, "2026-09-01T08:00:00.000Z", first), revision(2, "2026-09-15T08:00:00.000Z", second)],
    });
    expect(options.map((option) => option.source)).toEqual(["draft", 2, 1]);
    expect(options[0]).toMatchObject({ date: "2026-09-29T10:00:00.000Z", lines: 2, total: calculateQuote(draft).total });
    expect(options[1]).toMatchObject({ date: "2026-09-15T08:00:00.000Z", lines: 2, total: 12_000 });
    expect(options[2]).toMatchObject({ date: "2026-09-01T08:00:00.000Z", lines: 1, total: 8_000 });
  });

  it("gives an incompletely priced Working Draft no total", () => {
    const options = quoteSourceOptions({ draft: source(), updatedAt: "2026-09-29T10:00:00.000Z", revisions: [] });
    expect(options).toEqual([{ source: "draft", date: "2026-09-29T10:00:00.000Z", lines: 4, total: null, vatRegistered: null }]);
  });

  it("omits the Working Draft when there is none", () => {
    const options = quoteSourceOptions({ draft: null, updatedAt: "2026-09-29T10:00:00.000Z", revisions: [revision(1, "2026-09-01T08:00:00.000Z", emptyQuote("Q-1"))] });
    expect(options.map((option) => option.source)).toEqual([1]);
  });
});
