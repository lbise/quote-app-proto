import { useLoaderData } from 'react-router';
import type { Route } from './+types/admin.quote';
import { adminPage, asAdministrator } from '../lib/admin-area.server';
import { readQuoteForAdministrator } from '../lib/admin-inspection.server';
import type { PrintablePage } from '../lib/pdf-renderer.server';
import { quoteDocumentPage, type QuoteVersion } from '../lib/quote-pdf.server';
import { adminPaths } from '../components/admin/admin-shell';
import { AdminQuotePage } from '../components/admin/quote-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

/** The requested version when the Quote has it; otherwise the Working Draft, else the latest Published Revision. */
function shownVersion(requested: string | null, quote: { draft: unknown; revisions: { number: number }[] }): QuoteVersion | null {
  const numbers = quote.revisions.map(revision => revision.number);
  if (requested === 'draft' && quote.draft) return 'draft';
  if (requested && /^\d{1,9}$/.test(requested) && numbers.includes(Number(requested))) return Number(requested);
  return quote.draft ? 'draft' : numbers.at(-1) ?? null;
}

/** The printed page for the screen: Chromium adds the page margins when printing, so the preview adds them here. */
function onScreen(page: PrintablePage): string {
  const { top, right, bottom, left } = page.margin;
  return page.html.replace('</head>', `<style>@media screen { body { margin: 0; padding: ${top} ${right} ${bottom} ${left}; } }</style></head>`);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { administratorId, locale, database } = await adminPage(request);
  const quote = await asAdministrator(() => readQuoteForAdministrator(database, administratorId, params.quoteId ?? ''));
  if (!quote) throw new Response('Not Found', { status: 404 });
  const version = shownVersion(new URL(request.url).searchParams.get('version'), quote);
  const printed = version === null ? null : await quoteDocumentPage(database, { quoteId: quote.id, version, businessId: quote.business.id });
  return { locale, quote, version, page: printed ? { html: onScreen(printed.page), filename: printed.filename } : null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.quote.reference ?? ''} | Easy Quote` }];
}

export default function AdminQuote() {
  const loaded = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(loaded.locale, adminPaths.quote(loaded.quote.id));
  return <AdminQuotePage locale={locale} onLanguage={changeLanguage} quote={loaded.quote} version={loaded.version} page={loaded.page} />;
}
