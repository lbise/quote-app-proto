import { useEffect, useRef, useState } from 'react';
import { Link, useLoaderData, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Archive, FileText, Plus, TriangleAlert } from 'lucide-react';
import type { Route } from './+types/quotes';
import { requireApprovedArtisan } from '../lib/auth.server';
import { randomUUID } from '../lib/random-id';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import QuoteWorkspace from '../components/quotes/workspace';
import { deleteQuote, quoteRequest, startQuoteFrom, type QuoteList, type QuoteRecord, type StartedFrom } from '../components/quotes/use-quote';
import { StartFromDialog } from '../components/quotes/start-from-dialog';
import { parseQuoteSource, type QuoteSource } from '../lib/quote-start-from';
import { DeleteQuoteDialog, QuoteActionsMenu } from '../components/quotes/quote-lifecycle';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { AppShell } from '../components/app-shell';
import { swissAmount } from '../lib/quote';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireApprovedArtisan(request);
  return { locale: access.artisan.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'fr' ? 'Mes devis | Easy Quote' : 'My Quotes | Easy Quote' }];
}

/** The "Started from…" notice for a Quote just started from another, carried in navigation state. */
function startedFromState(state: unknown): StartedFrom | undefined {
  const value = (state as { startedFrom?: { reference?: unknown; from?: unknown } } | null)?.startedFrom;
  const from = parseQuoteSource(value?.from);
  return typeof value?.reference === 'string' && from !== null ? { reference: value.reference, from } : undefined;
}

export default function Quotes() {
  const initial = useLoaderData<typeof loader>();
  const [locale, setLocale] = useState(initial.locale);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const id = params.get('id');
  const [record, setRecord] = useState<QuoteRecord | null>(null);
  const [list, setList] = useState<QuoteList | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createId, setCreateId] = useState(() => randomUUID());
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [deleting, setDeleting] = useState<QuoteList['quotes'][number] | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [choosingSource, setChoosingSource] = useState<QuoteList['quotes'][number] | null>(null);
  const [startingFrom, setStartingFrom] = useState(false);
  // One request key per Quote copied at once, kept until it succeeds, so retrying after a lost response is safe.
  const immediateCopyKeys = useRef(new Map<string, string>());
  // Focus target after an action removed a row from the current tab.
  const nextFocus = useRef<string | null>(null);
  const rows = useRef<HTMLTableSectionElement | null>(null);
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;

  useEffect(() => {
    let active = true;
    setError(false); setRecord(null); setList(null);
    (id ? quoteRequest<QuoteRecord>(undefined, id) : quoteRequest<QuoteList>()).then(data => {
      if (!active) return;
      if (id) setRecord(data as QuoteRecord); else setList(data as QuoteList);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, attempt]);

  async function changeLanguage(language: 'en' | 'fr') {
    const response = await fetch('/language', { method: 'POST', body: new URLSearchParams({ locale: language, returnTo: '/quotes' }) });
    if (response.ok) setLocale(language);
    else setError(true);
  }
  async function create() {
    setCreating(true); setError(false);
    try {
      const next = await quoteRequest<QuoteRecord>({ action: 'create', requestId: createId });
      setCreateId(randomUUID());
      navigate(`/quotes?id=${encodeURIComponent(next.id)}`);
    } catch { setError(true); }
    finally { setCreating(false); }
  }
  /** Where focus goes when a row leaves the current tab: the next row, else the previous one, else the tabs. */
  function focusAfterRemoving(quoteId: string) {
    const shown = visible();
    const index = shown.findIndex(q => q.id === quoteId);
    nextFocus.current = (shown[index + 1] ?? shown[index - 1])?.id ?? null;
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      const row = nextFocus.current && rows.current?.querySelector<HTMLElement>(`[data-quote-id="${CSS.escape(nextFocus.current)}"] .qp-list-open`);
      nextFocus.current = null;
      (row || document.querySelector<HTMLElement>('.qp-list-tabs [data-state="active"]'))?.focus();
    });
  }
  async function setArchived(quote: QuoteList['quotes'][number], archived: boolean) {
    setActionFailed(false);
    focusAfterRemoving(quote.id);
    try {
      await quoteRequest<QuoteRecord>({ action: archived ? 'archive' : 'restore', id: quote.id, requestId: randomUUID() });
      setList(current => current && { ...current, quotes: current.quotes.map(q => q.id === quote.id ? { ...q, archived } : q) });
      setAnnouncement(archived
        ? t(`Devis ${quote.reference} archivé.`, `Quote ${quote.reference} archived.`)
        : t(`Devis ${quote.reference} restauré.`, `Quote ${quote.reference} restored.`));
      restoreFocus();
    } catch { nextFocus.current = null; setActionFailed(true); }
  }
  async function remove(requestId: string) {
    const quote = deleting;
    if (!quote) return true;
    focusAfterRemoving(quote.id);
    try {
      const next = await deleteQuote(quote.id, requestId);
      setList(current => current && (next ? { ...current, quotes: next.quotes } : { ...current, quotes: current.quotes.filter(q => q.id !== quote.id) }));
      setDeleting(null);
      setAnnouncement(t(`Devis ${quote.reference} supprimé.`, `Quote ${quote.reference} deleted.`));
      restoreFocus();
      return true;
    } catch { nextFocus.current = null; return false; }
  }
  /** Open a Quote just started from another, with a notice naming the version it was started from. */
  function openStarted(id: string, startedFrom: StartedFrom) {
    navigate(`/quotes?id=${encodeURIComponent(id)}`, { state: { startedFrom } });
  }
  async function copyFrom(quote: QuoteList['quotes'][number], from: QuoteSource, requestId: string) {
    setActionFailed(false); setStartingFrom(true);
    try {
      const next = await startQuoteFrom(quote.id, from, requestId);
      setChoosingSource(null);
      openStarted(next.id, { reference: quote.reference, from });
      return true;
    } catch { return false; }
    finally { setStartingFrom(false); }
  }
  /** A Quote with one version is copied at once; with several, the Artisan chooses one. Revisions are numbered from 1 without gaps. */
  function startNewQuoteFrom(quote: QuoteList['quotes'][number]) {
    const versions = quote.revision + (quote.hasDraft ? 1 : 0);
    if (versions > 1) { setChoosingSource(quote); return; }
    const keys = immediateCopyKeys.current;
    const requestId = keys.get(quote.id) ?? randomUUID();
    keys.set(quote.id, requestId);
    void copyFrom(quote, quote.hasDraft ? 'draft' : quote.revision, requestId).then(started => {
      if (started) keys.delete(quote.id); else setActionFailed(true);
    });
  }
  function visible() {
    return (list?.quotes ?? []).filter(q => q.archived === (tab === 'archived') && `${q.reference} ${q.title} ${q.customerName}`.toLowerCase().includes(filter.toLowerCase()));
  }
  if (record && id === record.id) return <QuoteWorkspace key={record.id} initial={record} locale={locale} startedFrom={startedFromState(location.state)} onLanguage={changeLanguage} onList={() => navigate('/quotes')} onStarted={openStarted} />;
  const updated = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', { dateStyle: 'medium', timeZone: 'Europe/Zurich' });
  const quoteLink = (quoteId: string) => `/quotes?id=${encodeURIComponent(quoteId)}`;
  return <AppShell className="qp-page qp-variant-b" current="quotes" locale={locale} onLanguage={changeLanguage}>
    <main className="qp-quote-list">
      <div className="qp-list-heading"><div><p>{t('Votre atelier', 'Your workshop')}</p><h1>{t('Mes devis', 'My Quotes')}</h1></div><Button disabled={creating} onClick={() => void create()}><Plus data-icon="inline-start" />{t('Nouveau devis', 'New Quote')}</Button></div>
      {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t('Chargement impossible', 'Could not load')}</AlertTitle><AlertDescription>{t('Vérifiez votre connexion puis réessayez.', 'Check your connection and retry.')}<Button variant="outline" onClick={() => setAttempt(v => v + 1)}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert>}
      {!list && !error && <p role="status">{t('Chargement…', 'Loading…')}</p>}
      {actionFailed && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t('Action non enregistrée', 'Action not saved')}</AlertTitle><AlertDescription>{t('Vérifiez votre connexion puis réessayez.', 'Check your connection and retry.')}</AlertDescription></Alert>}
      <p className="sr-only" role="status">{announcement}</p>
      {list && <Tabs value={tab} onValueChange={value => { if (value === 'active' || value === 'archived') setTab(value); }}>
        <div className="qp-list-controls">
          <TabsList variant="line" className="qp-list-tabs" aria-label={t('Devis affichés', 'Shown Quotes')}>
            <TabsTrigger value="active">{t('Actifs', 'Active')}</TabsTrigger>
            <TabsTrigger value="archived">{t('Archivés', 'Archived')}</TabsTrigger>
          </TabsList>
          <FieldGroup className="qp-search-label"><Field><FieldLabel htmlFor="quote-search">{t('Rechercher un devis', 'Search Quotes')}</FieldLabel><Input id="quote-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('Projet ou destinataire', 'Project or Customer')} /></Field></FieldGroup>
        </div>
        {/* Only the selected panel mounts; both render the same filtered rows. */}
        {(['active', 'archived'] as const).map(value => <TabsContent key={value} value={value}>{!list.quotes.length ? <div className="qp-list-empty"><FileText /><h2>{t('Votre premier devis commence ici.', 'Your first Quote starts here.')}</h2><p>{t('Décrivez les travaux. Les coordonnées pourront attendre.', 'Describe the work. Contact details can wait.')}</p><Button disabled={creating} onClick={() => void create()}>{t('Créer un devis', 'Create a Quote')}</Button></div>
          : !list.quotes.some(q => q.archived === (tab === 'archived'))
          ? <div className="qp-list-empty">{tab === 'archived' ? <><Archive /><h2>{t('Aucun devis archivé.', 'No Archived Quotes.')}</h2><p>{t('Archivez un devis pour le retirer de la liste active. Vous pourrez le restaurer.', 'Archive a Quote to set it aside from the active list. You can restore it later.')}</p></> : <><FileText /><h2>{t('Aucun devis actif.', 'No active Quotes.')}</h2><p>{t('Vos devis archivés restent dans l’onglet Archivés.', 'Your Archived Quotes stay in the Archived tab.')}</p></>}</div>
          : <><table className="eq-quote-table qp-list-table">
            <caption className="sr-only">{tab === 'archived' ? t('Devis archivés', 'Archived Quotes') : t('Devis actifs', 'Active Quotes')}</caption>
            <thead><tr>
              <th scope="col" className="eq-col-reference">{t('Référence', 'Reference')}</th>
              <th scope="col" className="eq-col-project">{t('Projet', 'Project')}</th>
              <th scope="col" className="eq-col-customer">{t('Client', 'Customer')}</th>
              <th scope="col" className="eq-col-status">{t('Statut', 'Status')}</th>
              <th scope="col" className="eq-col-amount">{t('Total CHF', 'Total CHF')}</th>
              <th scope="col" className="eq-col-updated">{t('Modifié le', 'Updated')}</th>
              <th scope="col" className="eq-col-actions"><span className="sr-only">{t('Actions', 'Actions')}</span></th>
            </tr></thead>
            <tbody ref={rows}>{visible().map(q => <tr className="qp-list-row" key={q.id} data-quote-id={q.id}
              // The whole row opens the Quote; the Project link is its keyboard and assistive-technology target.
              onClick={event => { if (!(event.target as Element).closest('a, button, [role="menu"], [role="dialog"]') && !window.getSelection()?.toString()) navigate(quoteLink(q.id)); }}>
              <td className="eq-col-reference">{q.reference}</td>
              <td className="eq-col-project"><Link className="qp-list-open" to={quoteLink(q.id)}>{q.title || t('Nouveau devis', 'New Quote')}</Link></td>
              <td className="eq-col-customer">{q.customerName || <span className="qp-list-missing">{t('Sans destinataire', 'No Customer')}</span>}</td>
              <td className="eq-col-status"><QuoteStatus locale={locale} quote={q} /></td>
              <td className="eq-col-amount">{q.total === null ? <span aria-label={t('À compléter', 'Incomplete')}>—</span> : swissAmount(q.total)}</td>
              <td className="eq-col-updated"><time dateTime={q.updatedAt}>{updated.format(new Date(q.updatedAt))}</time></td>
              <td className="eq-col-actions"><QuoteActionsMenu locale={locale} quote={q} archived={q.archived} disabled={startingFrom} onStartFrom={() => startNewQuoteFrom(q)} onArchive={() => void setArchived(q, true)} onRestore={() => void setArchived(q, false)} onDelete={() => setDeleting(q)} onMenuClosed={event => { if (nextFocus.current !== null) event.preventDefault(); }} /></td>
            </tr>)}</tbody>
          </table>{!visible().length && <p className="qp-list-footnote">{t('Aucun devis ne correspond à cette recherche.', 'No Quote matches this search.')}</p>}</>}</TabsContent>)}
      </Tabs>}
      <DeleteQuoteDialog locale={locale} quote={deleting} onCancel={() => setDeleting(null)} onConfirm={remove} />
      <StartFromDialog locale={locale} quote={choosingSource} onCancel={() => setChoosingSource(null)} onConfirm={(from, requestId) => choosingSource ? copyFrom(choosingSource, from, requestId) : Promise.resolve(false)} />
    </main>
  </AppShell>;
}

/**
 * Where a Quote stands: an Archived Quote, a Working Draft (possibly on top of
 * Published Revisions), or its latest Published Revision.
 */
function QuoteStatus({ locale, quote }: { locale: 'fr' | 'en'; quote: QuoteList['quotes'][number] }) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const status = quote.archived ? 'archived' : quote.hasDraft ? 'working-draft' : 'published';
  const label = quote.hasDraft ? t('Brouillon', 'Draft') : t(`Révision ${quote.revision}`, `Revision ${quote.revision}`);
  return <Badge variant="outline" className="eq-status" data-status={status} data-revision={quote.revision || undefined}>
    {quote.archived && <span className="eq-status-archived">{t('Archivé', 'Archived')} · </span>}{label}
  </Badge>;
}
