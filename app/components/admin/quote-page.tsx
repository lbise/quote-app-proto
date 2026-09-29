import { Link } from 'react-router';
import { Download, LockKeyhole } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AdministeredQuoteDetail } from '@/lib/admin-inspection.server';
import { AdminShell, DateTime, OutcomeBadge, t, type Locale } from './admin-shell';
import { adminQuotePath } from './businesses-page';
import { turnTracePath } from './turns-page';

type LanguageChange = (locale: Locale) => Promise<boolean>;
export type AdminQuoteVersion = number | 'draft';

function versionLabel(locale: Locale, version: AdminQuoteVersion) {
  return version === 'draft' ? t(locale, 'Brouillon', 'Working Draft') : t(locale, `Révision ${version}`, `Revision ${version}`);
}

function versionPath(quoteId: string, version: AdminQuoteVersion) {
  return `${adminQuotePath(quoteId)}?version=${version}`;
}

function downloadPath(quoteId: string, version: AdminQuoteVersion) {
  return version === 'draft' ? `${adminQuotePath(quoteId)}/draft-preview` : `${adminQuotePath(quoteId)}/revisions/${version}/document`;
}

function roleLabel(locale: Locale, role: AdministeredQuoteDetail['conversation'][number]['role']) {
  return { artisan: t(locale, 'Artisan', 'Artisan'), assistant: t(locale, 'Assistant', 'Assistant'), note: t(locale, 'Note', 'Note') }[role];
}

/**
 * A Quote as its Artisan Business has it, read-only: any version as printed,
 * and the conversation with a link to each Assistant Turn's Turn Trace.
 */
export function AdminQuotePage({ locale, onLanguage, quote, version, page }: {
  locale: Locale; onLanguage: LanguageChange;
  quote: AdministeredQuoteDetail;
  /** The version shown, or null when the Quote has none to show. */
  version: AdminQuoteVersion | null;
  /** The shown version's printable HTML, as its PDF would render it. */
  page: { html: string; filename: string } | null;
}) {
  const versions: AdminQuoteVersion[] = [...(quote.draft ? ['draft' as const] : []), ...quote.revisions.map(revision => revision.number).reverse()];
  const turns = quote.conversation.filter(entry => entry.traces !== undefined).length;
  return <AdminShell locale={locale} onLanguage={onLanguage} section="businesses" wide
    back={{ to: `/admin/businesses/${encodeURIComponent(quote.business.id)}`, label: quote.business.name || t(locale, 'Entreprise sans nom', 'Unnamed business') }}
    title={<><span className="qp-admin-reference">{quote.reference}</span> {quote.title || t(locale, 'Nouveau devis', 'New Quote')}</>}
    description={<>{quote.business.owner.name} · {quote.business.owner.email} · {t(locale, 'modifié le', 'changed')} <DateTime locale={locale} value={quote.updatedAt} /></>}
    actions={quote.archived ? <Badge variant="secondary">{t(locale, 'Archivé', 'Archived')}</Badge> : undefined}>
    <p className="qp-admin-readonly"><LockKeyhole />{t(locale,
      'Consultation seulement. L’administration ne peut ni modifier, ni publier, ni archiver, ni supprimer ce devis.',
      'Read-only. The admin area cannot edit, publish, archive or delete this Quote.')}</p>
    <div className="qp-admin-quote">
      <section className="qp-panel" aria-labelledby="admin-document-heading">
        <header className="qp-panel-header qp-admin-document-header">
          <h2 id="admin-document-heading">{t(locale, 'Document', 'Document')}</h2>
          {versions.length > 0 && <nav className="qp-admin-versions" aria-label={t(locale, 'Versions du devis', 'Quote versions')}>
            {versions.map(entry => <Link key={entry} to={versionPath(quote.id, entry)} aria-current={entry === version ? 'page' : undefined} replace>{versionLabel(locale, entry)}</Link>)}
          </nav>}
        </header>
        {version !== null && page
          ? <>
            <div className="qp-admin-document-actions">
              <Button asChild size="sm" variant="outline"><a href={downloadPath(quote.id, version)} download={page.filename}>
                <Download data-icon="inline-start" />{version === 'draft' ? t(locale, 'Télécharger l’aperçu du brouillon', 'Download Draft Preview') : t(locale, 'Télécharger le devis', 'Download Quote Document')}
              </a></Button>
            </div>
            <iframe className="qp-admin-document" title={`${quote.reference} · ${versionLabel(locale, version)}`} srcDoc={page.html} sandbox="" />
          </>
          : <p className="qp-admin-empty">{t(locale, 'Ce devis n’a ni brouillon ni révision publiée.', 'This Quote has neither a Working Draft nor a Published Revision.')}</p>}
      </section>

      <section className="qp-panel" aria-labelledby="admin-conversation-heading">
        <header className="qp-panel-header">
          <h2 id="admin-conversation-heading">{t(locale, 'Conversation', 'Conversation')}</h2>
          <p>{turns === 1 ? t(locale, '1 tour de l’assistant', '1 Assistant Turn') : t(locale, `${turns} tours de l’assistant`, `${turns} Assistant Turns`)} · <Link className="qp-admin-link" to={`/admin/turns?quote=${encodeURIComponent(quote.id)}`}>{t(locale, 'toutes les traces de ce devis', 'all Turn Traces of this Quote')}</Link></p>
        </header>
        {quote.conversation.length === 0
          ? <p className="qp-admin-empty">{t(locale, 'Aucun message.', 'No messages.')}</p>
          : <ol className="qp-admin-conversation">
            {quote.conversation.map(entry => <li key={entry.id} data-role={entry.role}>
              <header><strong>{roleLabel(locale, entry.role)}</strong><DateTime locale={locale} value={entry.createdAt} /></header>
              <p>{entry[locale]}</p>
              {entry.traces && <div className="qp-admin-turn">
                {entry.traces.length === 0
                  ? <span className="qp-admin-muted">{t(locale, 'Trace expirée : les traces sont conservées 30 jours.', 'Turn Trace expired: Turn Traces are kept for 30 days.')}</span>
                  : entry.traces.map((trace, index) => <span key={trace.id} className="qp-admin-turn-trace">
                    <Link className="qp-admin-link" to={turnTracePath(trace.id)}>{entry.traces!.length > 1 ? t(locale, `Voir la trace ${index + 1}`, `View trace ${index + 1}`) : t(locale, 'Voir la trace', 'View trace')}</Link>
                    <OutcomeBadge locale={locale} kind={trace.outcomeKind} />
                  </span>)}
              </div>}
            </li>)}
          </ol>}
      </section>
    </div>
  </AdminShell>;
}
