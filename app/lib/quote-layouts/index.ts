import type { PrintablePage } from "../pdf-renderer.server";
import type { QuoteDocumentContent } from "../quote-document";
import { renderStandardV1 } from "./standard-v1";

/** A Quote Layout version. Published Revisions record the id and version they were published with. */
export type QuoteLayout = { id: string; version: number; render(content: QuoteDocumentContent): PrintablePage };
export type QuoteLayoutKey = Pick<QuoteLayout, "id" | "version">;

/** Every Quote Layout version ever published. Never remove one: older revisions still render with it. */
export const quoteLayouts: readonly QuoteLayout[] = [
  { id: "standard", version: 1, render: renderStandardV1 },
];

/** The Quote Layout recorded at Publication and used for Draft Previews. */
export const currentQuoteLayout: QuoteLayout = quoteLayouts[0];

export function findQuoteLayout(layouts: readonly QuoteLayout[], key: QuoteLayoutKey): QuoteLayout | undefined {
  return layouts.find((layout) => layout.id === key.id && layout.version === key.version);
}
