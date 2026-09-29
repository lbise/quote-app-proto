import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import type { AdministeredQuote, BusinessOverview } from '@/lib/admin-inspection.server';
import { AdminShell, adminPaths, DateTime, t, Unnamed, UserStatusBadge, type LanguageChange, type Locale } from './admin-shell';

function quoteCounts(locale: Locale, business: BusinessOverview) {
  return t(locale, `${business.activeQuotes} actifs · ${business.archivedQuotes} archivés`, `${business.activeQuotes} active · ${business.archivedQuotes} archived`);
}

function Owner({ owner }: { owner: BusinessOverview['owner'] }) {
  return <div className="qp-admin-user"><strong>{owner.name}</strong><span>{owner.email}</span></div>;
}

/** Every Artisan Business, most recently active first. */
export function BusinessesPage({ locale, onLanguage, businesses }: { locale: Locale; onLanguage: LanguageChange; businesses: BusinessOverview[] }) {
  return <AdminShell locale={locale} onLanguage={onLanguage} section="businesses" title={t(locale, 'Entreprises', 'Artisan Businesses')}
    description={t(locale, 'Chaque entreprise, son propriétaire, ses devis et sa dernière activité. Consultation seulement.', 'Every Artisan Business with its owner, Quotes and last activity. Read-only.')}>
    <section className="qp-panel" aria-labelledby="admin-businesses-heading">
      <header className="qp-panel-header">
        <h2 id="admin-businesses-heading">{t(locale, 'Entreprises', 'Businesses')}</h2>
        <p>{businesses.length === 1 ? t(locale, '1 entreprise', '1 business') : t(locale, `${businesses.length} entreprises`, `${businesses.length} businesses`)}</p>
      </header>
      {businesses.length === 0
        ? <p className="qp-admin-empty">{t(locale, 'Aucune entreprise pour le moment.', 'No Artisan Businesses yet.')}</p>
        : <div className="qp-admin-table-scroll">
          <table className="qp-admin-table">
            <thead><tr>
              <th scope="col">{t(locale, 'Entreprise', 'Business')}</th>
              <th scope="col">{t(locale, 'Propriétaire', 'Owner')}</th>
              <th scope="col">{t(locale, 'Statut', 'Status')}</th>
              <th scope="col">{t(locale, 'Devis', 'Quotes')}</th>
              <th scope="col">{t(locale, 'Dernière activité', 'Last activity')}</th>
            </tr></thead>
            <tbody>
              {businesses.map(business => <tr key={business.id}>
                <td><Link className="qp-admin-link" to={adminPaths.business(business.id)}>{business.name || <Unnamed locale={locale} />}</Link></td>
                <td><Owner owner={business.owner} /></td>
                <td><UserStatusBadge locale={locale} status={business.owner.status} /></td>
                <td className="qp-admin-nowrap">{quoteCounts(locale, business)}</td>
                <td>{business.lastActivityAt ? <DateTime locale={locale} value={business.lastActivityAt} /> : <span className="qp-admin-muted">—</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>
  </AdminShell>;
}

/** One Artisan Business and all its Quotes, Archived Quotes included. */
export function BusinessPage({ locale, onLanguage, business, quotes }: { locale: Locale; onLanguage: LanguageChange; business: BusinessOverview; quotes: AdministeredQuote[] }) {
  return <AdminShell locale={locale} onLanguage={onLanguage} section="businesses"
    back={{ to: '/admin/businesses', label: t(locale, 'Entreprises', 'Businesses') }}
    title={business.name || t(locale, 'Entreprise sans nom', 'Unnamed business')}
    description={<>{business.owner.name} · {business.owner.email} · {quoteCounts(locale, business)}</>}
    actions={<UserStatusBadge locale={locale} status={business.owner.status} />}>
    <section className="qp-panel" aria-labelledby="admin-quotes-heading">
      <header className="qp-panel-header">
        <h2 id="admin-quotes-heading">{t(locale, 'Devis', 'Quotes')}</h2>
        <p>{t(locale, 'Devis actifs et archivés, du plus récemment modifié au plus ancien.', 'Active and Archived Quotes, most recently changed first.')}</p>
      </header>
      {quotes.length === 0
        ? <p className="qp-admin-empty">{t(locale, 'Aucun devis.', 'No Quotes.')}</p>
        : <div className="qp-admin-table-scroll">
          <table className="qp-admin-table">
            <thead><tr>
              <th scope="col">{t(locale, 'Devis', 'Quote')}</th>
              <th scope="col">{t(locale, 'Client', 'Customer')}</th>
              <th scope="col">{t(locale, 'Version', 'Version')}</th>
              <th scope="col">{t(locale, 'Modifié le', 'Changed')}</th>
            </tr></thead>
            <tbody>
              {quotes.map(quote => <tr key={quote.id}>
                <td><div className="qp-admin-user">
                  <Link className="qp-admin-link" to={adminPaths.quote(quote.id)}>{quote.title || t(locale, 'Nouveau devis', 'New Quote')}</Link>
                  <span>{quote.reference}</span>
                </div></td>
                <td>{quote.customerName || <span className="qp-admin-muted">{t(locale, 'Sans destinataire', 'No Customer')}</span>}</td>
                <td><div className="qp-admin-badges">
                  <Badge variant="outline">{quote.hasDraft ? t(locale, 'Brouillon', 'Draft') : t(locale, `Révision ${quote.revision}`, `Revision ${quote.revision}`)}</Badge>
                  {quote.archived && <Badge variant="secondary">{t(locale, 'Archivé', 'Archived')}</Badge>}
                </div></td>
                <td><DateTime locale={locale} value={quote.updatedAt} /></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>
  </AdminShell>;
}
