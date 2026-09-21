import type { QuoteData } from "./quote";

export const MAX_QUOTE_LINES = 1_000;
export const MAX_QUOTE_SECTIONS = 1_000;
export const MAX_QUOTE_DRAFT_BYTES = 220_000;

export type QuoteDraftLimit = "line_count" | "section_count" | "draft_bytes";

export function quoteDraftLimit(quote: QuoteData): QuoteDraftLimit | undefined {
  if (quote.lines.length > MAX_QUOTE_LINES) return "line_count";
  if (quote.sections.length > MAX_QUOTE_SECTIONS) return "section_count";
  if (new TextEncoder().encode(JSON.stringify(quote)).byteLength > MAX_QUOTE_DRAFT_BYTES) return "draft_bytes";
  return undefined;
}
