import type { QuoteData, QuoteLine, QuoteSection } from "./quote";

/** Ungrouped lines come first, followed by each section's lines in section order. */
function orderLines(lines: QuoteLine[], sections: QuoteSection[]): QuoteLine[] {
  const rank = new Map(sections.map((section, index) => [section.id, index]));
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const aRank = a.line.sectionId === "" ? -1 : rank.get(a.line.sectionId) ?? sections.length;
      const bRank = b.line.sectionId === "" ? -1 : rank.get(b.line.sectionId) ?? sections.length;
      return aRank - bRank || a.index - b.index;
    })
    .map(({ line }) => line);
}

export function addQuoteSection(quote: QuoteData, afterId: string | null, newId: string, title: string): QuoteData {
  const afterIndex = afterId === null ? null : quote.sections.findIndex((section) => section.id === afterId);
  if (afterIndex === -1) return quote;
  const index = afterIndex === null ? quote.sections.length : afterIndex + 1;
  const sections = [...quote.sections];
  sections.splice(index, 0, { id: newId, title });
  return { ...quote, sections, lines: orderLines(quote.lines, sections) };
}

export function renameQuoteSection(quote: QuoteData, id: string, title: string): QuoteData {
  if (!quote.sections.some((section) => section.id === id)) return quote;
  return {
    ...quote,
    sections: quote.sections.map((section) => section.id === id ? { ...section, title } : section),
    lines: orderLines(quote.lines, quote.sections),
  };
}

export function moveQuoteSection(quote: QuoteData, id: string, delta: number): QuoteData {
  const index = quote.sections.findIndex((section) => section.id === id);
  const destination = index + delta;
  if (index < 0 || !Number.isInteger(delta) || destination < 0 || destination >= quote.sections.length || delta === 0) return quote;
  const sections = [...quote.sections];
  const [section] = sections.splice(index, 1);
  sections.splice(destination, 0, section);
  return { ...quote, sections, lines: orderLines(quote.lines, sections) };
}

export function duplicateQuoteSection(quote: QuoteData, id: string, newId: string, newLineId: () => string): QuoteData {
  const index = quote.sections.findIndex((section) => section.id === id);
  if (index < 0) return quote;
  const sections = [...quote.sections];
  sections.splice(index + 1, 0, { ...sections[index], id: newId });
  const lines = [
    ...quote.lines,
    ...quote.lines.filter((line) => line.sectionId === id).map((line) => ({ ...line, id: newLineId(), sectionId: newId })),
  ];
  return { ...quote, sections, lines: orderLines(lines, sections) };
}

/** Removing a section alone keeps its lines; deleting it discards them. */
export function removeQuoteSection(quote: QuoteData, id: string, deleteLines: boolean): QuoteData {
  if (!quote.sections.some((section) => section.id === id)) return quote;
  const sections = quote.sections.filter((section) => section.id !== id);
  const lines = deleteLines
    ? quote.lines.filter((line) => line.sectionId !== id)
    : [
      ...quote.lines.filter((line) => line.sectionId !== id),
      ...quote.lines.filter((line) => line.sectionId === id).map((line) => ({ ...line, sectionId: "" })),
    ];
  return { ...quote, sections, lines: orderLines(lines, sections) };
}
