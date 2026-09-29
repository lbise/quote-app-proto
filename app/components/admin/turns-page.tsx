import { Form, Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { turnOutcomeKinds } from '@/lib/turn-trace';
import type { TurnTraceFilter, TurnTraceSummary } from '@/lib/turn-traces.server';
import { AdminShell, DateTime, formatCost, formatNumber, OutcomeBadge, outcomeLabel, t, type Locale } from './admin-shell';
import { adminQuotePath } from './businesses-page';

type LanguageChange = (locale: Locale) => Promise<boolean>;
export type TurnListUser = { id: string; name: string; email: string };

export const turnTracePath = (id: string) => `/admin/turns/${encodeURIComponent(id)}`;

/** The list URL for a filter and page, keeping only what is set. */
function listPath(filter: TurnTraceFilter, page: number) {
  const params = new URLSearchParams();
  if (filter.outcomeKind) params.set('outcome', filter.outcomeKind);
  if (filter.userId) params.set('user', filter.userId);
  if (filter.quoteId) params.set('quote', filter.quoteId);
  if (filter.from) params.set('from', filter.from);
  if (filter.to) params.set('to', filter.to);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/admin/turns?${query}` : '/admin/turns';
}

/** Every retained Assistant Turn, newest first, filtered by outcome, User, date range or Quote. */
export function TurnsPage({ locale, onLanguage, traces, hasMore, page, filter, users, quote }: {
  locale: Locale; onLanguage: LanguageChange;
  traces: TurnTraceSummary[]; hasMore: boolean; page: number;
  filter: TurnTraceFilter; users: TurnListUser[];
  /** The Quote the list is limited to, when it is. */
  quote: { id: string; reference: string } | null;
}) {
  const filtered = Boolean(filter.outcomeKind || filter.userId || filter.quoteId || filter.from || filter.to);
  return <AdminShell locale={locale} onLanguage={onLanguage} section="turns" wide title={t(locale, 'Tours de l’assistant', 'Assistant Turns')}
    description={t(locale, 'Chaque tour dont la trace est conservée, du plus récent au plus ancien. Les traces sont conservées 30 jours.', 'Every Assistant Turn with a Turn Trace, newest first. Turn Traces are kept for 30 days.')}>
    <Form method="get" className="qp-admin-filters" aria-label={t(locale, 'Filtres', 'Filters')}>
      {filter.quoteId && <input type="hidden" name="quote" value={filter.quoteId} />}
      <label><span>{t(locale, 'Résultat', 'Outcome')}</span>
        <select name="outcome" defaultValue={filter.outcomeKind ?? ''}>
          <option value="">{t(locale, 'Tous', 'All')}</option>
          {turnOutcomeKinds.map(kind => <option key={kind} value={kind}>{outcomeLabel(locale, kind)}</option>)}
        </select>
      </label>
      <label><span>{t(locale, 'Utilisateur', 'User')}</span>
        <select name="user" defaultValue={filter.userId ?? ''}>
          <option value="">{t(locale, 'Tous', 'All')}</option>
          {users.map(user => <option key={user.id} value={user.id}>{user.name ? `${user.name} · ${user.email}` : user.email}</option>)}
        </select>
      </label>
      <label><span>{t(locale, 'Du', 'From')}</span><Input type="date" name="from" defaultValue={filter.from ?? ''} /></label>
      <label><span>{t(locale, 'Au', 'To')}</span><Input type="date" name="to" defaultValue={filter.to ?? ''} /></label>
      <div className="qp-admin-filter-actions">
        <Button type="submit" size="sm">{t(locale, 'Filtrer', 'Filter')}</Button>
        {filtered && <Button asChild size="sm" variant="ghost"><Link to="/admin/turns">{t(locale, 'Tout afficher', 'Clear filters')}</Link></Button>}
      </div>
    </Form>
    {quote && <p className="qp-admin-scope">{t(locale, 'Limité au devis', 'Limited to Quote')} <Link className="qp-admin-link" to={adminQuotePath(quote.id)}>{quote.reference}</Link> · <Link className="qp-admin-link" to={listPath({ ...filter, quoteId: undefined }, 1)}>{t(locale, 'tous les devis', 'all Quotes')}</Link></p>}

    <section className="qp-panel" aria-labelledby="admin-turns-heading">
      <header className="qp-panel-header">
        <h2 id="admin-turns-heading">{t(locale, 'Tours', 'Turns')}</h2>
        {page > 1 && <p>{t(locale, `Page ${page}`, `Page ${page}`)}</p>}
      </header>
      {traces.length === 0
        ? <p className="qp-admin-empty">{filtered ? t(locale, 'Aucun tour ne correspond à ces filtres.', 'No Assistant Turn matches these filters.') : t(locale, 'Aucun tour pour le moment.', 'No Assistant Turns yet.')}</p>
        : <div className="qp-admin-table-scroll">
          <table className="qp-admin-table">
            <thead><tr>
              <th scope="col">{t(locale, 'Heure', 'Time')}</th>
              <th scope="col">{t(locale, 'Utilisateur', 'User')}</th>
              <th scope="col">{t(locale, 'Entreprise', 'Business')}</th>
              <th scope="col">{t(locale, 'Devis', 'Quote')}</th>
              <th scope="col">{t(locale, 'Résultat', 'Outcome')}</th>
              <th scope="col">{t(locale, 'Modèle', 'Model')}</th>
              <th scope="col" className="qp-admin-number">{t(locale, 'Appels', 'Calls')}</th>
              <th scope="col" className="qp-admin-number">{t(locale, 'Jetons (entrée / sortie)', 'Tokens (in / out)')}</th>
              <th scope="col" className="qp-admin-number">{t(locale, 'Coût', 'Cost')}</th>
            </tr></thead>
            <tbody>
              {traces.map(trace => <tr key={trace.id}>
                <td><Link className="qp-admin-link" to={turnTracePath(trace.id)} aria-label={`${t(locale, 'Voir la trace', 'View trace')} ${trace.quote.reference}`}><DateTime locale={locale} value={trace.createdAt} seconds /></Link></td>
                <td>{trace.user ? <div className="qp-admin-user"><strong>{trace.user.name}</strong><span>{trace.user.email}</span></div> : <span className="qp-admin-muted">{t(locale, 'Supprimé', 'Deleted')}</span>}</td>
                <td><Link className="qp-admin-link" to={`/admin/businesses/${encodeURIComponent(trace.business.id)}`}>{trace.business.name || t(locale, 'Sans nom', 'Unnamed')}</Link></td>
                <td><Link className="qp-admin-link" to={adminQuotePath(trace.quote.id)}>{trace.quote.reference}</Link></td>
                <td><OutcomeBadge locale={locale} kind={trace.outcomeKind} /></td>
                <td>{trace.model ?? <span className="qp-admin-muted">—</span>}</td>
                <td className="qp-admin-number">{formatNumber(locale, trace.modelCallCount)}</td>
                <td className="qp-admin-number">{formatNumber(locale, trace.inputTokens)} / {formatNumber(locale, trace.outputTokens)}</td>
                <td className="qp-admin-number">{formatCost(locale, trace.costUsd)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      {(page > 1 || hasMore) && <nav className="qp-admin-pages" aria-label={t(locale, 'Pages', 'Pages')}>
        {page > 1 ? <Button asChild size="sm" variant="outline"><Link to={listPath(filter, page - 1)}>{t(locale, 'Plus récents', 'Newer')}</Link></Button> : <span />}
        {hasMore && <Button asChild size="sm" variant="outline"><Link to={listPath(filter, page + 1)}>{t(locale, 'Plus anciens', 'Older')}</Link></Button>}
      </nav>}
    </section>
  </AdminShell>;
}
