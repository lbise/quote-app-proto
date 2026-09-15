import { useEffect, useState } from 'react';
import { useLoaderData, useNavigate, useRouteLoaderData, useSearchParams } from 'react-router';
import { ArrowRight, FileText, Plus, TriangleAlert } from 'lucide-react';
import type { Route } from './+types/quotes';
import { requireApprovedArtisan } from '../lib/auth.server';
import { randomUUID } from '../lib/random-id';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import QuoteWorkspace from '../components/quotes/workspace';
import { quoteRequest, type QuoteList, type QuoteRecord } from '../components/quotes/use-quote';
import { QuoteHeader } from '../components/quotes/quote-header';
import { RecordsEditor } from '../components/quotes/records-editor';
import { AssistantDisclosure } from '../components/quotes/assistant-disclosure';
import type { QuoteAIDisclosure } from '../lib/quote-ai-disclosure';
import '../components/quotes/quotes.css';

export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireApprovedArtisan(request);
  return { locale: access.artisan.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'fr' ? 'Mes devis | Easy Quote' : 'My Quotes | Easy Quote' }];
}

export default function Quotes() {
  const initial = useLoaderData<typeof loader>();
  const { quoteAI } = useRouteLoaderData('root') as { quoteAI: QuoteAIDisclosure };
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
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [privacy, setPrivacy] = useState(false);
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
  if (record && id === record.id) return <QuoteWorkspace key={record.id} initial={record} locale={locale} onLanguage={changeLanguage} onList={() => navigate('/quotes')} />;
  return <div className="qp-app qp-variant-b" lang={locale}>
    <QuoteHeader locale={locale} onLanguage={changeLanguage} onList={() => navigate('/quotes')} onRecords={() => setRecordsOpen(true)} onPrivacy={() => setPrivacy(v => !v)} />
    {privacy && <AssistantDisclosure locale={locale} processing={quoteAI} onClose={() => setPrivacy(false)} />}
    <main className="qp-quote-list">
      <div className="qp-list-heading"><div><p>{t('Votre atelier', 'Your workshop')}</p><h1>{t('Mes devis', 'My Quotes')}</h1></div><Button disabled={creating} onClick={() => void create()}><Plus data-icon="inline-start" />{t('Nouveau devis', 'New Quote')}</Button></div>
      {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t('Chargement impossible', 'Could not load')}</AlertTitle><AlertDescription>{t('Vérifiez votre connexion puis réessayez.', 'Check your connection and retry.')}<Button variant="outline" onClick={() => setAttempt(v => v + 1)}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert>}
      {!list && !error && <p role="status">{t('Chargement…', 'Loading…')}</p>}
      {list && <><FieldGroup className="qp-search-label"><Field><FieldLabel htmlFor="quote-search">{t('Rechercher un devis', 'Search Quotes')}</FieldLabel><Input id="quote-search" value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('Projet ou destinataire', 'Project or Customer')} /></Field></FieldGroup>
        {!list.quotes.length ? <div className="qp-list-empty"><FileText /><h2>{t('Votre premier devis commence ici.', 'Your first Quote starts here.')}</h2><p>{t('Décrivez les travaux. Les coordonnées pourront attendre.', 'Describe the work. Contact details can wait.')}</p><Button disabled={creating} onClick={() => void create()}>{t('Créer un devis', 'Create a Quote')}</Button></div> : <div className="qp-list-rows">{list.quotes.filter(q => `${q.reference} ${q.title} ${q.customerName}`.toLowerCase().includes(filter.toLowerCase())).map(q => <button className="qp-list-row" key={q.id} onClick={() => navigate(`/quotes?id=${encodeURIComponent(q.id)}`)}><FileText /><div><strong>{q.title || t('Nouveau devis', 'New Quote')}</strong><span>{q.customerName || t('Sans destinataire', 'No Customer')} · {q.reference}</span></div><Badge variant="outline">{q.hasDraft ? t('Brouillon', 'Draft') : t(`Révision ${q.revision}`, `Revision ${q.revision}`)}</Badge><ArrowRight /></button>)}</div>}
      </>}
    </main>
    {recordsOpen && <RecordsEditor quote={null} locale={locale} onApply={() => {}} onClose={() => setRecordsOpen(false)} />}
  </div>;
}
