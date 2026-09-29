import { and, eq } from "drizzle-orm";

import { requireAdministrator } from "./administration.server";
import { getAuth } from "./auth.server";
import { findBusinessLogo } from "./business-logo.server";
import { quote, quoteRevision } from "./db/schema";
import { type Database, getDatabase } from "./db.server";
import { getPdfRenderer, type PdfRenderer, type PrintablePage } from "./pdf-renderer.server";
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

/** Which version of a Quote to print: a Published Revision by number, or the Working Draft as a Draft Preview. */
export type QuoteVersion = number | "draft";

/**
 * The printable page of one Quote version: a Published Revision's Quote
 * Document in its recorded Quote Layout, or a Draft Preview of the saved
 * Working Draft in the current one. `businessId` confines the Quote to one
 * Artisan Business; null reads any business's Quote, for Administrators only.
 */
export async function quoteDocumentPage(
  database: Database,
  target: { quoteId: string; version: QuoteVersion; businessId: string | null },
  { layouts = quoteLayouts, currentLayout = currentQuoteLayout }: Pick<QuotePdfDependencies, "layouts" | "currentLayout"> = {},
): Promise<{ page: PrintablePage; filename: string }> {
  const scope = target.businessId === null ? undefined : eq(quote.businessId, target.businessId);
  const [record] = await database.select({ businessId: quote.businessId, draft: quote.draft }).from(quote)
    .where(and(eq(quote.id, target.quoteId), scope)).limit(1);
  let source: QuoteDocumentSource;
  let layout: QuoteLayout | undefined;
  if (target.version === "draft") {
    if (!record) throw new RequestFailure(404, "quote_not_found");
    if (!record.draft) throw new RequestFailure(409, "working_draft_required");
    source = { kind: "draft", quote: record.draft as QuoteData };
    layout = currentLayout;
  } else {
    const [revision] = record ? await database.select().from(quoteRevision)
      .where(and(eq(quoteRevision.quoteId, target.quoteId), eq(quoteRevision.businessId, record.businessId), eq(quoteRevision.number, target.version)))
      .limit(1) : [];
    if (!record || !revision) throw new RequestFailure(404, "revision_not_found");
    source = { kind: "published", revisionNumber: revision.number, quote: revision.quote as QuoteData, calculation: revision.calculation as QuoteCalculation };
    layout = findQuoteLayout(layouts, { id: revision.layoutId, version: revision.layoutVersion });
  }
  if (!layout) throw new RequestFailure(500, "quote_layout_unavailable");
  const logo = await findBusinessLogo(database, record.businessId, source.quote.logoId);
  const content = quoteDocumentContent({ ...source, logo });
  return { page: layout.render(content), filename: content.filename };
}

/**
 * PDF downloads under a path prefix: `<prefix>/:id/revisions/:number/document`
 * for a Quote Document and `<prefix>/:id/draft-preview` for a Draft Preview.
 * PDFs are rendered on each download and never stored (ADR 0004).
 */
function createPdfHandler(prefix: string, access: (request: Request) => Promise<string | null>, dependencies: QuotePdfDependencies) {
  const database = dependencies.database ?? getDatabase();
  const renderer = () => dependencies.renderer ?? getPdfRenderer();
  const documentPath = new RegExp(`^${prefix}/([^/]+)/revisions/(\\d{1,9})/document$`);
  const draftPreviewPath = new RegExp(`^${prefix}/([^/]+)/draft-preview$`);

  return async function quotePdfHandler(request: Request): Promise<Response> {
    try {
      if (request.method !== "GET") throw new RequestFailure(405, "method_not_allowed");
      const businessId = await access(request);
      const path = new URL(request.url).pathname;
      const document = documentPath.exec(path);
      const preview = draftPreviewPath.exec(path);
      if (!document && !preview) throw new RequestFailure(404, "not_found");
      const { page, filename } = await quoteDocumentPage(database, {
        quoteId: quoteIdFrom((document ?? preview)![1]),
        version: document ? Number(document[2]) : "draft",
        businessId,
      }, dependencies);
      const pdf = await renderer().render(page);
      return new Response(pdf as Uint8Array<ArrayBuffer>, { headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      } });
    } catch (error) {
      if (error instanceof Response) return error;
      return failureResponse(error, "pdf_failed");
    }
  };
}

/**
 * Authenticated PDF downloads of the Artisan's own Quotes (docs/quote-pdf.md):
 * - `GET /api/quotes/:id/revisions/:number/document`: a Published Revision's Quote Document, in its recorded Quote Layout.
 * - `GET /api/quotes/:id/draft-preview`: a Draft Preview of the saved Working Draft, in the current Quote Layout.
 */
export function createQuotePdfHandler(dependencies: QuotePdfDependencies = {}) {
  const database = dependencies.database ?? getDatabase();
  const auth = dependencies.auth ?? getAuth();
  return createPdfHandler("/api/quotes", (request) => authorised(request, auth, database), { ...dependencies, database });
}

/**
 * The same downloads of any business's Quote, for Administrators, under
 * `/admin/quotes`. Everyone else gets a not-found response.
 */
export function createAdministratorQuotePdfHandler(dependencies: QuotePdfDependencies = {}) {
  const auth = dependencies.auth ?? getAuth();
  return createPdfHandler("/admin/quotes", async (request) => {
    await requireAdministrator(request, auth);
    return null;
  }, dependencies);
}

function quoteIdFrom(segment: string): string {
  try { return decodeURIComponent(segment); }
  catch { throw new RequestFailure(404, "quote_not_found"); }
}
