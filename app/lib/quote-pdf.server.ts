import { and, eq } from "drizzle-orm";

import { getAuth } from "./auth.server";
import { findBusinessLogo } from "./business-logo.server";
import { quote, quoteRevision } from "./db/schema";
import { type Database, getDatabase } from "./db.server";
import { getPdfRenderer, type PdfRenderer } from "./pdf-renderer.server";
import type { QuoteCalculation, QuoteData } from "./quote";
import { quoteDocumentContent, type QuoteDocumentSource } from "./quote-document";
import { currentQuoteLayout, findQuoteLayout, quoteLayouts, type QuoteLayout } from "./quote-layouts";
import { authorised, failureResponse, RequestFailure, type SessionAuth } from "./quotes.server";

export type QuotePdfDependencies = {
  database?: Database;
  auth?: SessionAuth;
  renderer?: PdfRenderer;
  /** Every available Quote Layout version, and the one used for Draft Previews. */
  layouts?: readonly QuoteLayout[];
  currentLayout?: QuoteLayout;
};

const documentPath = /^\/api\/quotes\/([^/]+)\/revisions\/(\d{1,9})\/document$/;
const draftPreviewPath = /^\/api\/quotes\/([^/]+)\/draft-preview$/;

/**
 * Authenticated PDF downloads (docs/quote-pdf.md):
 * - `GET /api/quotes/:id/revisions/:number/document`: a Published Revision's Quote Document, in its recorded Quote Layout.
 * - `GET /api/quotes/:id/draft-preview`: a Draft Preview of the saved Working Draft, in the current Quote Layout.
 * PDFs are rendered on each download and never stored (ADR 0004).
 */
export function createQuotePdfHandler(dependencies: QuotePdfDependencies = {}) {
  const database = dependencies.database ?? getDatabase();
  const auth = dependencies.auth ?? getAuth();
  const layouts = dependencies.layouts ?? quoteLayouts;
  const currentLayout = dependencies.currentLayout ?? currentQuoteLayout;
  const renderer = () => dependencies.renderer ?? getPdfRenderer();

  return async function quotePdfHandler(request: Request): Promise<Response> {
    try {
      if (request.method !== "GET") throw new RequestFailure(405, "method_not_allowed");
      const businessId = await authorised(request, auth, database);
      const path = new URL(request.url).pathname;
      const document = documentPath.exec(path);
      const preview = draftPreviewPath.exec(path);
      let source: QuoteDocumentSource;
      let layout: QuoteLayout | undefined;
      if (document) {
        const [revision] = await database.select().from(quoteRevision)
          .where(and(eq(quoteRevision.quoteId, quoteIdFrom(document[1])), eq(quoteRevision.businessId, businessId), eq(quoteRevision.number, Number(document[2]))))
          .limit(1);
        if (!revision) throw new RequestFailure(404, "revision_not_found");
        source = { kind: "published", revisionNumber: revision.number, quote: revision.quote as QuoteData, calculation: revision.calculation as QuoteCalculation };
        layout = findQuoteLayout(layouts, { id: revision.layoutId, version: revision.layoutVersion });
      } else if (preview) {
        const [record] = await database.select({ draft: quote.draft }).from(quote)
          .where(and(eq(quote.id, quoteIdFrom(preview[1])), eq(quote.businessId, businessId))).limit(1);
        if (!record) throw new RequestFailure(404, "quote_not_found");
        if (!record.draft) throw new RequestFailure(409, "working_draft_required");
        source = { kind: "draft", quote: record.draft as QuoteData };
        layout = currentLayout;
      } else {
        throw new RequestFailure(404, "not_found");
      }
      if (!layout) throw new RequestFailure(500, "quote_layout_unavailable");
      const logo = await findBusinessLogo(database, businessId, source.quote.logoId);
      const content = quoteDocumentContent({ ...source, logo });
      const pdf = await renderer().render(layout.render(content));
      return new Response(pdf as Uint8Array<ArrayBuffer>, { headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${content.filename}"; filename*=UTF-8''${encodeURIComponent(content.filename)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      } });
    } catch (error) {
      return failureResponse(error, "pdf_failed");
    }
  };
}

function quoteIdFrom(segment: string): string {
  try { return decodeURIComponent(segment); }
  catch { throw new RequestFailure(404, "quote_not_found"); }
}
