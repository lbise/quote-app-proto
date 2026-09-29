import { useEffect, useRef, useState } from 'react';
import { useLoaderData, useNavigate, useSearchParams } from 'react-router';
import { Archive, ArrowRight, FileText, Plus, TriangleAlert } from 'lucide-react';
import type { Route } from './+types/quotes';
import { requireApprovedArtisan } from '../lib/auth.server';
import { randomUUID } from '../lib/random-id';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import QuoteWorkspace from '../components/quotes/workspace';
import { deleteQuote, quoteRequest, type QuoteList, type QuoteRecord } from '../components/quotes/use-quote';
import { DeleteQuoteDialog, QuoteActionsMenu } from '../components/quotes/quote-lifecycle';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { QuoteHeader } from '../components/quotes/quote-header';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireApprovedArtisan(request);
  return { locale: access.artisan.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'fr' ? 'Mes devis | Easy Quote' : 'My Quotes | Easy Quote' }];
}

export default function Quotes() {
  const initial = useLoaderData<typeof loader>();
  const [locale, setLocale] = useState(initial.locale);
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
  // Focus target after an action removed a row from the current tab.
  const nextFocus = useRef<string | null>(null);
  const rows = useRef<HTMLDivElement | null>(null);
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
  function visible() {
    return (list?.quotes ?? []).filter(q => q.archived === (tab === 'archived') && `${q.reference} ${q.title} ${q.customerName}`.toLowerCase().includes(filter.toLowerCase()));
  }
  if (record && id === record.id) return <QuoteWorkspace key={record.id} initial={record} locale={locale} onLanguage={changeLanguage} onList={() => navigate('/quotes')} />;
  return <div className="qp-app qp-page qp-variant-b" lang={locale}>
    <QuoteHeader current="quotes" locale={locale} onLanguage={changeLanguage} onList={() => navigate('/quotes')} />
    <main className="qp-quote-list">
      <div className="qp-list-heading"><div><p>{t('Votre atelier', 'Your workshop')}</p><h1>{t('Mes devis', 'My Quotes')}</h1></div><Button disabled={creating} onClick={() => void create()}><Plus data-icon="inline-start" />{t('Nouveau devis', 'New Quote')}</Button></div>
      {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t('Chargement impossible', 'Could not load')}</AlertTitle><AlertDescription>{t('Vérifiez votre connexion puis réessayez.', 'Check your connection and retry.')}<Button variant="outline" onClick={() => setAttempt(v => v + 1)}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert>}
      {!list && !error && <p role="status">{t('Chargement…', 'Loading…')}</p>}
      {actionFailed && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t('Action non enregistrée', 'Action not saved')}</AlertTitle><AlertDescription>{t('Vérifiez votre connexion puis réessayez.', 'Check your connection and retry.')}</AlertDescription></Alert>}
      <p className="sr-only" role="status">{announcement}</p>
      {list && <>
        <div className="qp-list-controls">
          <Tabs value={tab} onValueChange={value => { if (value === 'active' || value === 'archived') setTab(value); }}>
            <TabsList variant="line" className="qp-list-tabs" aria-label={t('Devis affichés', 'Shown Quotes')}>
              <TabsTrigger value="active">{t('Actifs', 'Active')}</TabsTrigger>
              <TabsTrigger value="archived">{t('Archivés', 'Archived')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <FieldGroup className="qp-search-label"><Field><FieldLabel htmlFor="quote-search">{t('Rechercher un devis', 'Search Quotes')}</FieldLabel><Input id="quote-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('Projet ou destinataire', 'Project or Customer')} /></Field></FieldGroup>
        </div>
        {!list.quotes.length ? <div className="qp-list-empty"><FileText /><h2>{t('Votre premier devis commence ici.', 'Your first Quote starts here.')}</h2><p>{t('Décrivez les travaux. Les coordonnées pourront attendre.', 'Describe the work. Contact details can wait.')}</p><Button disabled={creating} onClick={() => void create()}>{t('Créer un devis', 'Create a Quote')}</Button></div>
          : !list.quotes.some(q => q.archived === (tab === 'archived'))
          ? <div className="qp-list-empty">{tab === 'archived' ? <><Archive /><h2>{t('Aucun devis archivé.', 'No Archived Quotes.')}</h2><p>{t('Archivez un devis pour le retirer de la liste active. Vous pourrez le restaurer.', 'Archive a Quote to set it aside from the active list. You can restore it later.')}</p></> : <><FileText /><h2>{t('Aucun devis actif.', 'No active Quotes.')}</h2><p>{t('Vos devis archivés restent dans l’onglet Archivés.', 'Your Archived Quotes stay in the Archived tab.')}</p></>}</div>
          : <div className="qp-list-rows" ref={rows}>{visible().map(q => <div className="qp-list-row" key={q.id} data-quote-id={q.id}>
            <button className="qp-list-open" onClick={() => navigate(`/quotes?id=${encodeURIComponent(q.id)}`)}><FileText /><div><strong>{q.title || t('Nouveau devis', 'New Quote')}</strong><span>{q.customerName || t('Sans destinataire', 'No Customer')} · {q.reference}</span></div><Badge variant="outline">{q.hasDraft ? t('Brouillon', 'Draft') : t(`Révision ${q.revision}`, `Revision ${q.revision}`)}</Badge><ArrowRight /></button>
            <QuoteActionsMenu locale={locale} quote={q} archived={q.archived} onArchive={() => void setArchived(q, true)} onRestore={() => void setArchived(q, false)} onDelete={() => setDeleting(q)} onMenuClosed={event => { if (nextFocus.current !== null) event.preventDefault(); }} />
          </div>)}{!visible().length && <p className="qp-list-footnote">{t('Aucun devis ne correspond à cette recherche.', 'No Quote matches this search.')}</p>}</div>}
      </>}
      <DeleteQuoteDialog locale={locale} quote={deleting} onCancel={() => setDeleting(null)} onConfirm={remove} />
    </main>
  </div>;
}
