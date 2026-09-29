import { calculateQuote, type QuoteCalculation, type QuoteData } from "./quote";

/**
 * The version a new Quote starts from: the source Quote's Working Draft or one
 * of its Published Revisions, by number. The Artisan always chooses it.
 */
export type QuoteSource = "draft" | number;

/** The request value naming a source version, or null when it names none. */
export function parseQuoteSource(value: unknown): QuoteSource | null {
  if (value === "draft") return value;
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

/**
 * The work a new Quote takes from its source: the title, and the sections and
 * lines in order with new IDs. Prices are copied as they are. Everything else
 * comes from a new Quote, not the source.
 */
export function workFromSource(source: QuoteData, newId: (kind: "section" | "line") => string): Pick<QuoteData, "title" | "sections" | "lines"> {
  const sectionIds = new Map<string, string>();
  const sections = source.sections.map((section) => {
    const id = newId("section");
    sectionIds.set(section.id, id);
    return { id, title: section.title };
  });
  const lines = source.lines.map((line) => ({
    id: newId("line"),
    sectionId: line.sectionId === "" ? "" : sectionIds.get(line.sectionId) ?? "",
    description: line.description,
    mode: line.mode,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    amount: line.amount,
  }));
  return { title: source.title, sections, lines };
}

type Locale = "fr" | "en";

/**
 * "New Quote from Revision 2" in a menu, or "Started from Q-12, Revision 2" in
 * the notice shown when the new Quote opens.
 */
export function quoteSourceName(source: QuoteSource, locale: Locale, form: "menu" | "notice", reference = ""): string {
  const fr = locale === "fr";
  if (form === "menu") {
    if (source === "draft") return fr ? "Nouveau devis à partir du brouillon de travail" : "New Quote from the Working Draft";
    return fr ? `Nouveau devis à partir de la révision ${source}` : `New Quote from Revision ${source}`;
  }
  const version = source === "draft" ? (fr ? "brouillon de travail" : "Working Draft") : (fr ? `révision ${source}` : `Revision ${source}`);
  return fr ? `Créé à partir de ${reference}, ${version}` : `Started from ${reference}, ${version}`;
}

export type QuoteSourceOption = {
  source: QuoteSource;
  /** When the Working Draft was last edited, or when the revision was published. */
  date: string;
  lines: number;
  /** The total in cents, including VAT when registered; null while incomplete. */
  total: number | null;
  vatRegistered: boolean | null;
};

/** The versions a new Quote can start from: the Working Draft first, then revisions newest first. */
export function quoteSourceOptions(record: {
  draft: QuoteData | null;
  updatedAt: string;
  revisions: { number: number; publishedAt: string; quote: QuoteData; calculation: Pick<QuoteCalculation, "total"> }[];
}): QuoteSourceOption[] {
  const options: QuoteSourceOption[] = [];
  if (record.draft) {
    options.push({ source: "draft", date: record.updatedAt, lines: record.draft.lines.length, total: calculateQuote(record.draft).total, vatRegistered: record.draft.vatRegistered });
  }
  for (const revision of [...record.revisions].sort((a, b) => b.number - a.number)) {
    options.push({ source: revision.number, date: revision.publishedAt, lines: revision.quote.lines.length, total: revision.calculation.total, vatRegistered: revision.quote.vatRegistered });
  }
  return options;
}
