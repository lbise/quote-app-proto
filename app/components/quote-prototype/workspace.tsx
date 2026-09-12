// THROWAWAY #8: Three conversation-forward desk layouts on /quote-layout-prototype?variant=A|B|C.
// In-memory fixtures, scripted assistant, saving and publication. No production mutations.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, ChevronDown, Copy, FileText, List, LockKeyhole, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Settings2, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Field, FieldGroup, FieldLabel } from '../ui/field';
import { Message, MessageContent, MessageHeader } from '../ui/message';
import { Bubble, BubbleContent } from '../ui/bubble';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from '../ui/message-scroller';
import { PrototypeSwitcher } from '../prototype-switcher';
import { makeJoineryQuote, makeFlatQuote, makeEmptyQuote, type QuoteData, type QuoteLine } from './fixtures';
import { lineCents, money, publicationMissing, totals } from './calculations';
import { LineEditor, ManualEditor } from './manual-editor';

type Locale = 'fr' | 'en';
type Chat = { role: 'artisan' | 'assistant' | 'note'; fr: string; en: string; changed?: string[] };
type RecordState = { id: string; draft: QuoteData | null; revisions: QuoteData[]; messages: Chat[] };
type LayoutProps = { chat: ReactNode; document: ReactNode; outline: ReactNode; toolbar: ReactNode };
export function VariantA(p: LayoutProps) { return <div className="qp-layout qp-layout-a">{p.toolbar}<div className="qp-split">{p.chat}{p.document}</div></div>; }
export function VariantB(p: LayoutProps & { showOutline: boolean; hasSections: boolean }) { return <div className="qp-layout qp-layout-b"><div id="qp-review-outline" className="qp-review-rail" hidden={!p.hasSections} data-collapsed={!p.showOutline}>{p.outline}</div><div className="qp-review-main">{p.toolbar}<div className="qp-split">{p.document}{p.chat}</div></div></div>; }
export function VariantC(p: LayoutProps) { return <div className="qp-layout qp-layout-c">{p.toolbar}<div className="qp-split">{p.chat}<div className="qp-focus-review">{p.outline}{p.document}</div></div></div>; }
const clone = <T,>(value: T): T => structuredClone(value);
function seed() {
  const q = makeJoineryQuote();
  const fixed = q.lines.find(l => l.mode === 'fixed');
  const measured = q.lines.find(l => l.mode === 'quantity');
  if (fixed) fixed.amount = '';
  if (measured) measured.quantity = '';
  return q;
}
const opening: Chat[] = [
  { role: 'artisan', fr: 'Je prépare le devis de menuiserie pour la maison des Tilleuls. Regroupe le travail par pièce : cuisine, entrée, séjour, chambres, salle de bains et buanderie. Garde les descriptions détaillées des assemblages.', en: 'I am preparing the joinery Quote for Maison des Tilleuls. Group the work by room: kitchen, entrance, living room, bedrooms, bathroom and laundry. Keep the detailed assembly descriptions.' },
  { role: 'assistant', fr: 'Le brouillon est organisé en 7 sections. Les assemblages restent au forfait : leurs mesures sont conservées dans la description, sans créer de prix supplémentaires.', en: 'The draft is organised into 7 sections. Assemblies remain fixed-price: their measurements stay in the description, without creating extra charges.' },
  { role: 'artisan', fr: 'Il me reste le montant du premier forfait et une quantité à confirmer. On termine ces deux points avant de relire le devis.', en: 'I still need to confirm the first fixed amount and one quantity. Let us finish those before reviewing the Quote.' },
  { role: 'assistant', fr: 'Ces deux valeurs sont laissées vides. Le sous-total ne comprend que les lignes chiffrées. Quel montant et quelle quantité souhaitez-vous retenir ?', en: 'Those two values are blank. The partial subtotal includes only priced lines. What amount and quantity would you like to use?' },
];

export default function QuotePrototype() {
  const [params, setParams] = useSearchParams();
  const locale: Locale = params.get('lang') === 'en' ? 'en' : 'fr';
  const variant = ['A', 'B', 'C'].includes(params.get('variant') ?? '') ? params.get('variant')! : 'A';
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const [quote, setQuote] = useState<QuoteData>(seed);
  const [messages, setMessages] = useState<Chat[]>(opening);
  const [records, setRecords] = useState<RecordState[]>([]);
  const [recordId, setRecordId] = useState('joinery');
  const [revisions, setRevisions] = useState<QuoteData[]>([]);
  const [draft, setDraft] = useState<QuoteData | null>(null);
  const [readRevision, setReadRevision] = useState<number | null>(null);
  const [list, setList] = useState(false);
  const [listFilter, setListFilter] = useState('');
  const [emptyList, setEmptyList] = useState(false);
  const [input, setInput] = useState('');
  const [save, setSave] = useState<'saved' | 'saving' | 'error'>('saved');
  const [ai, setAi] = useState<'idle' | 'processing' | 'error' | 'stale'>('idle');
  const [failure, setFailure] = useState<'none' | 'ai' | 'save' | 'slow'>('none');
  const [previous, setPrevious] = useState<QuoteData | null>(null);
  const [changed, setChanged] = useState<string[]>([]);
  const [editLine, setEditLine] = useState<QuoteLine | null>(null);
  const [modal, setModal] = useState<'details' | 'publish' | 'sections' | 'scenarios' | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const showOutline = quote.sections.length > 0 && !outlineCollapsed;
  const [fullDocument, setFullDocument] = useState(false);
  const [narrowPanel, setNarrowPanel] = useState<'chat' | 'quote'>('chat');
  const version = useRef(0), requestToken = useRef(0), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequest = useRef<{ text: string; action: string }>({ text: '', action: '' });
  const returnFocus = useRef<HTMLElement | null>(null);
  const sum = totals(quote), readOnly = readRevision !== null;
  const missingAdmin = publicationMissing(quote);
  const blocked = sum.total === null || missingAdmin || save !== 'saved' || ai === 'processing';
  const activeSection = quote.sections.some(s => s.id === sectionId) ? sectionId : quote.sections[0]?.id || '';
  const referenceQuote = makeJoineryQuote();
  const missingLines = quote.lines.filter(l => lineCents(l) === null);
  const valuePrompt = missingLines.map(l => {
    const original = referenceQuote.lines.find(x => x.id === l.id);
    return original ? `${quote.lines.indexOf(l) + 1} : ${l.mode === 'fixed' ? `${original.amount} CHF` : `${original.quantity} ${original.unit}, ${original.unitPrice} CHF/${original.unit}`}` : '';
  }).filter(Boolean).join(' ; ');
  const allRecords: RecordState[] = [...records.filter(r => r.id !== recordId), { id: recordId, draft: readOnly ? draft : quote, revisions, messages }];

  useEffect(() => {
    if (save === 'saved') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [save]);
  useEffect(() => () => { requestToken.current++; if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    // Relevant state is visible in the scenario inspector; no commercial content is logged.
    document.documentElement.dataset.quotePrototype = variant;
    return () => { delete document.documentElement.dataset.quotePrototype; };
  }, [variant]);
  function saveLater(forceSuccess = false) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSave('saving');
    saveTimer.current = setTimeout(() => setSave(!forceSuccess && failure === 'save' ? 'error' : 'saved'), 900);
  }
  function apply(next: QuoteData, ids: string[] = [], note?: Chat) {
    if (readOnly) return;
    setPrevious(clone(quote)); setQuote(next); setChanged(ids); version.current++; saveLater();
    if (note) setMessages(m => [...m, note]);
  }
  function closeModal() { setModal(null); setEditLine(null); setTimeout(() => returnFocus.current?.focus({ preventScroll: true }), 0); }
  function openModal(name: typeof modal) { returnFocus.current = document.activeElement as HTMLElement; setModal(name); }
  function edit(line: QuoteLine) { returnFocus.current = document.activeElement as HTMLElement; setEditLine(clone(line)); }
  function reveal(id: string) {
    const line = quote.lines.find(l => l.id === id);
    if (line) setSectionId(line.sectionId);
    setNarrowPanel('quote');
    setTimeout(() => document.getElementById(`line-${id}`)?.scrollIntoView({ behavior: 'instant', block: 'center' }), 20);
  }
  function undo() {
    if (!previous || readOnly) return;
    setQuote(previous); setPrevious(null); setChanged([]); version.current++; saveLater();
    setMessages(m => [...m, { role: 'note', fr: 'Dernière modification annulée. Le devis précédent est rétabli.', en: 'Latest change undone. The previous Quote content is restored.' }]);
  }
  function archiveCurrent() { setRecords(allRecords); }
  function openRecord(record: RecordState) {
    archiveCurrent(); requestToken.current++; version.current++; setAi('idle'); setSave('saved');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setRecordId(record.id); setRevisions(record.revisions); setDraft(null);
    setQuote(clone(record.draft ?? record.revisions.at(-1)!)); setReadRevision(record.draft ? null : record.revisions.length - 1);
    setMessages(record.messages); setPrevious(null); setChanged([]); setSectionId(''); setOutlineCollapsed(false); setList(false);
  }
  function loadSample(kind: 'joinery' | 'flat' | 'empty' | 'complete') {
    archiveCurrent(); requestToken.current++; version.current++; setAi('idle'); setSave('saved'); setFailure('none');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setQuote(kind === 'flat' ? makeFlatQuote() : kind === 'empty' ? makeEmptyQuote() : kind === 'complete' ? makeJoineryQuote() : seed());
    setRecordId(`sample-${Date.now()}`); setRevisions([]); setDraft(null); setReadRevision(null); setPrevious(null); setChanged([]); setSectionId(''); setOutlineCollapsed(false); setList(false);
    setMessages(kind === 'joinery' ? opening : [{ role: 'assistant', fr: kind === 'empty' ? 'Décrivez les travaux, les matériaux et les prix que vous connaissez. Les coordonnées peuvent attendre.' : 'Cet exemple est prêt à être relu. Vous pouvez modifier chaque ligne ou me demander une correction.', en: kind === 'empty' ? 'Describe the work, materials and prices you know. Contact details can wait.' : 'This example is ready for review. Edit any line or ask me for a correction.' }]);
    setInput(''); closeModal();
  }
  function runAssistant(text: string, action = 'clarify', retry = false) {
    if (!text.trim() || readOnly || ai === 'processing') return;
    const captured = version.current, token = ++requestToken.current;
    lastRequest.current = { text, action }; setAi('processing'); setInput('');
    if (!retry) setMessages(m => [...m, { role: 'artisan', fr: text, en: text }]);
    saveLater();
    setTimeout(() => {
      if (requestToken.current !== token) return;
      if (captured !== version.current) { setAi('stale'); saveLater(); return; }
      if (failure === 'ai' && !retry) { setAi('error'); saveLater(); return; }
      setAi('idle');
      const next = clone(quote);
      let ids: string[] = [], fr = '', en = '';
      if (action === 'fill') {
        next.lines = next.lines.map(l => { const original = referenceQuote.lines.find(x => x.id === l.id); if (original && lineCents(l) === null) { ids.push(l.id); return { ...l, amount: original.amount, quantity: original.quantity, unitPrice: original.unitPrice }; } return l; });
        fr = 'Les valeurs indiquées sont appliquées. Le total comprend maintenant toutes les lignes. Relisez les deux lignes modifiées.';
        en = 'The supplied values are applied. The total now includes every line. Review the two changed lines.';
      } else if (action === 'discount') {
        next.discountMode = 'percent'; next.discount = '3';
        fr = 'Remise globale de 3 % appliquée avant TVA. Les prix des lignes restent inchangés.'; en = 'A 3% whole-Quote discount is applied before VAT. Line prices are unchanged.';
      } else if (action === 'copy') {
        const source = next.sections.find(s => s.id === activeSection);
        if (source) {
          const id = `section-${Date.now()}`;
          next.sections.push({ id, title: `${source.title} · copie` });
          const copied = next.lines.filter(l => l.sectionId === source.id).map((l, i) => ({ ...l, id: `${id}-${i}`, sectionId: id, quantity: l.mode === 'quantity' ? '' : l.quantity }));
          next.lines.push(...copied); ids = copied.map(l => l.id); setSectionId(id);
          fr = 'Section copiée. Descriptions, unités, prix unitaires et forfaits conservés. Les quantités mesurées sont laissées vides, comme demandé. Vérifiez aussi les mesures internes des forfaits.';
          en = 'Section copied. Descriptions, units, unit prices and fixed amounts retained. Measured quantities are blank as requested. Also review the internal measurements in fixed-price descriptions.';
        }
      } else if (action === 'start') {
        const id = `line-${Date.now()}`;
        next.title = 'Habillage mural en chêne';
        next.lines.push({ id, sectionId: '', description: 'Fourniture et pose d’un habillage mural en chêne.', mode: 'quantity', quantity: '12', unit: 'm²', unitPrice: '180', amount: '' }); ids = [id];
        fr = 'Habillage en chêne ajouté : 12 m² à 180 CHF/m², soit 2’160.00 CHF hors TVA. Quelle finition souhaitez-vous prévoir ?';
        en = 'Oak wall cladding added: 12 m² at CHF 180/m², CHF 2,160.00 before VAT. Which finish should be included?';
      } else {
        setMessages(m => [...m, { role: 'assistant', fr: 'Ce prototype ne comprend pas les demandes libres. Utilisez une demande de démonstration pour essayer une modification, ou corrigez directement le devis. Aucun contenu n’a été changé.', en: 'This prototype does not interpret free-form requests. Use a demo request to try a change, or edit the Quote directly. No content was changed.' }]); saveLater(); return;
      }
      apply(next, ids, { role: 'assistant', fr, en, changed: ids });
      if (ids[0]) setTimeout(() => reveal(ids[0]), 30);
    }, failure === 'slow' ? 9000 : 1600);
  }
  function moveLine(line: QuoteLine, delta: number) {
    const next = clone(quote), i = next.lines.findIndex(l => l.id === line.id), j = i + delta;
    if (j < 0 || j >= next.lines.length) return;
    next.lines[i].sectionId = next.lines[j].sectionId;
    [next.lines[i], next.lines[j]] = [next.lines[j], next.lines[i]];
    apply(next, [line.id]);
  }
  function publish() {
    if (blocked) return;
    const frozen = clone(quote); setRevisions(r => [...r, frozen]); setReadRevision(revisions.length); setDraft(null); setPrevious(null); setChanged([]); closeModal();
    setMessages(m => [...m, { role: 'note', fr: `Révision ${revisions.length + 1} publiée. Aucun envoi au destinataire.`, en: `Revision ${revisions.length + 1} published. Nothing was sent to the Customer.` }]);
  }
  function newRevision() {
    if (draft) { setQuote(draft); setDraft(null); } else setQuote(clone(revisions.at(-1)!));
    setReadRevision(null); setPrevious(null); setChanged([]); version.current++; saveLater();
  }

  const status = <span className={`qp-save qp-save-${save}`} role="status">{save === 'saved' ? <CheckCheck /> : save === 'error' ? <TriangleAlert /> : <span className="qp-spinner" />}{save === 'saved' ? t('Enregistré', 'Saved') : save === 'saving' ? t('Enregistrement…', 'Saving…') : t('Non enregistré', 'Not saved')}{save === 'error' && <Button size="sm" variant="ghost" onClick={() => saveLater(true)}>{t('Réessayer', 'Retry')}</Button>}</span>;
  const toolbar = <div className="qp-work-toolbar">
    <div className="qp-document-status"><Badge variant={readOnly ? 'secondary' : 'outline'}>{readOnly ? <LockKeyhole data-icon="inline-start" /> : <Pencil data-icon="inline-start" />}{readOnly ? t(`Révision publiée ${readRevision + 1}`, `Published revision ${readRevision + 1}`) : t('Brouillon de travail', 'Working draft')}</Badge>{!readOnly && status}</div>
    <div className="qp-toolbar-actions">
      {revisions.length > 0 && <select aria-label={t('Version du devis', 'Quote version')} value={readRevision === null ? 'draft' : String(readRevision)} onChange={e => {
        if (e.target.value === 'draft') { if (draft) { setQuote(draft); setDraft(null); setReadRevision(null); } return; }
        if (!readOnly) setDraft(clone(quote)); const n = Number(e.target.value); setQuote(clone(revisions[n])); setReadRevision(n); setPrevious(null);
      }} disabled={save !== 'saved' || ai === 'processing'}>{(!readOnly || draft) && <option value="draft">{t('Brouillon', 'Draft')}</option>}{revisions.map((_, i) => <option key={i} value={i}>{t('Révision', 'Revision')} {i + 1}</option>)}</select>}
      {!readOnly && <Button variant="ghost" disabled={!previous} onClick={undo}><RotateCcw data-icon="inline-start" />{t('Annuler', 'Undo')}</Button>}
      {readOnly ? <Button onClick={newRevision}><Pencil data-icon="inline-start" />{draft ? t('Reprendre', 'Resume draft') : t('Nouvelle révision', 'New revision')}</Button> : <Button onClick={() => openModal('publish')}><Check data-icon="inline-start" />{t('Relire et publier', 'Review & publish')}</Button>}
    </div>
  </div>;

  const outlineLinks = <>
    {quote.sections.map((section) => { const lines = quote.lines.filter(l => l.sectionId === section.id), missing = lines.some(l => lineCents(l) === null); return <button key={section.id} className={activeSection === section.id ? 'is-current' : ''} aria-current={activeSection === section.id ? 'true' : undefined} onClick={() => { setSectionId(section.id); setNarrowPanel('quote'); setTimeout(() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ block: 'start' }), 0); }}><span>{section.title}</span>{missing ? <TriangleAlert aria-label={t('À compléter', 'Incomplete')} /> : <span>{lines.length}</span>}</button>; })}
    {!readOnly && <Button variant="ghost" onClick={() => openModal('sections')}><Settings2 data-icon="inline-start" />{t('Organiser', 'Organise')}</Button>}
  </>;
  const outline = <nav className="qp-outline" aria-label={t('Sections du devis', 'Quote sections')}>
    <div className="qp-outline-heading"><div className="qp-outline-title-row"><span>{variant === 'B' ? 'Sections' : t('Dans ce devis', 'In this Quote')}</span>{variant === 'B' && <Button variant="ghost" size="icon-sm" aria-label={showOutline ? t('Réduire les sections', 'Collapse sections') : t('Développer les sections', 'Expand sections')} title={showOutline ? t('Réduire les sections', 'Collapse sections') : t('Développer les sections', 'Expand sections')} aria-controls="qp-section-links" aria-expanded={showOutline} onClick={() => setOutlineCollapsed(x => !x)}>{showOutline ? <PanelLeftClose /> : <PanelLeftOpen />}</Button>}</div>{variant !== 'B' && <span>{quote.lines.length} {t('lignes', 'lines')}</span>}</div>
    {variant === 'B' ? <div id="qp-section-links" className="qp-outline qp-outline-links" hidden={!showOutline}>{outlineLinks}</div> : outlineLinks}
  </nav>;

  function runExample(text: string, action: string) {
    if (modal === 'scenarios') closeModal();
    runAssistant(text, action);
  }
  const exampleRequests = <div>
    {valuePrompt && <button disabled={ai === 'processing'} onClick={() => runExample(valuePrompt, 'fill')}>{t('Compléter les valeurs', 'Complete the values')}<span>{valuePrompt}</span></button>}
    {!quote.lines.length ? <button disabled={ai === 'processing'} onClick={() => runExample(t('Habillage mural en chêne, 12 m² à 180 CHF/m².', 'Oak wall cladding, 12 m² at CHF 180/m².'), 'start')}>{t('Décrire un premier travail', 'Describe the first job')}<span>Chêne · 12 m² · 180 CHF/m²</span></button> : <button disabled={ai === 'processing'} onClick={() => runExample(t('Applique une remise globale de 3 %.', 'Apply a 3% whole-Quote discount.'), 'discount')}>{t('Appliquer 3 % de remise', 'Apply a 3% discount')}<ArrowRight /></button>}
    {quote.sections.length > 0 && <button disabled={ai === 'processing'} onClick={() => runExample(t(`Duplique « ${quote.sections.find(s => s.id === activeSection)?.title} ». Je n’ai pas encore les nouvelles quantités.`, `Duplicate “${quote.sections.find(s => s.id === activeSection)?.title}”. I do not have the new quantities yet.`), 'copy')}>{t('Dupliquer sans les quantités', 'Duplicate without quantities')}<Copy /></button>}
  </div>;

  const chat = <section className="qp-conversation" aria-label={t('Conversation avec l’assistant', 'Conversation with assistant')}>
    <header className="qp-panel-heading"><div className="qp-assistant-heading"><MessageSquare /><div><h2>{t('Préparons votre devis', 'Prepare your Quote')}</h2>{variant !== 'B' && <p>{t('Décrivez le travail. Affinons les détails.', 'Describe the work. Refine the details.')}</p>}</div></div><span className="qp-simulation-label">{t('Simulation', 'Simulated')}</span></header>
    <MessageScrollerProvider key={recordId} autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={0}><MessageScroller className="qp-chat-scroller">
      <MessageScrollerViewport><MessageScrollerContent className="qp-chat-content">
        <p className="qp-conversation-date">{t('Conversation de démonstration', 'Demo conversation')}</p>
        {messages.map((message, i) => <MessageScrollerItem key={i} messageId={`message-${i}`} scrollAnchor={message.role === 'artisan'}>
          <Message align={message.role === 'artisan' ? 'end' : 'start'} className={message.role === 'note' ? 'qp-note-message' : ''}><MessageContent>
            <MessageHeader>{message.role === 'artisan' ? t('Vous', 'You') : message.role === 'note' ? t('Historique', 'History') : 'Easy Quote'}</MessageHeader>
            <Bubble variant={message.role === 'artisan' ? 'secondary' : 'ghost'}><BubbleContent>{message[locale]}</BubbleContent></Bubble>
            {!!message.changed?.length && <div className="qp-change-links"><span><Check />{message.changed.length} {t('lignes modifiées', 'lines changed')}</span><Button variant="link" size="sm" onClick={() => reveal(message.changed![0])}>{t('Voir dans le devis', 'View in Quote')}<ArrowRight data-icon="inline-end" /></Button></div>}
          </MessageContent></Message>
        </MessageScrollerItem>)}
        {ai === 'processing' && <MessageScrollerItem><p className="qp-processing" role="status"><span className="qp-spinner" />{t('Je prépare la modification. Vous pouvez continuer à éditer.', 'Preparing the change. You can keep editing.')}</p></MessageScrollerItem>}
        {(ai === 'error' || ai === 'stale') && <MessageScrollerItem><Alert variant="destructive"><TriangleAlert /><AlertTitle>{ai === 'stale' ? t('Votre correction est conservée', 'Your edit is preserved') : t('L’assistant n’a pas répondu', 'The assistant did not respond')}</AlertTitle><AlertDescription><p>{ai === 'stale' ? t('La réponse est devenue obsolète pendant votre modification. Elle n’a pas été appliquée.', 'The response became stale while you edited. It was not applied.') : t('Le devis n’a pas changé. Réessayez ou continuez manuellement.', 'The Quote is unchanged. Retry or continue manually.')}</p><Button variant="outline" onClick={() => { setFailure('none'); runAssistant(lastRequest.current.text, lastRequest.current.action, true); }}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert></MessageScrollerItem>}
      </MessageScrollerContent></MessageScrollerViewport>
      <MessageScrollerButton aria-label={t('Dernier message', 'Latest message')} />
    </MessageScroller></MessageScrollerProvider>
    <div className="qp-compose-area">
      {readOnly ? <div className="qp-chat-locked"><LockKeyhole /><p>{t('Cette révision est figée. Créez un brouillon pour poursuivre.', 'This revision is frozen. Create a draft to continue.')}</p></div> : <>
        {variant !== 'B' && <details className="qp-prompt-examples" open={messages.length < 6}><summary>{t('Essayer une demande', 'Try a request')}<ChevronDown /></summary>{exampleRequests}</details>}
        <form className="qp-composer" onSubmit={e => { e.preventDefault(); runAssistant(input); }}>
          <label htmlFor="assistant-message">{t('Votre message', 'Your message')}</label>
          <Textarea id="assistant-message" placeholder={t('Ajoutez une précision, un prix, une correction…', 'Add a detail, a price, a correction…')} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAssistant(input); } }} />
          <div className="qp-composer-footer"><span>{t('Texte uniquement · Ctrl + Entrée', 'Text only · Ctrl + Enter')}</span><Button type="submit" disabled={!input.trim() || ai === 'processing'} aria-label={t('Envoyer le message', 'Send message')}><ArrowUp /></Button></div>
        </form>
        {variant !== 'B' && <p className="qp-ai-disclosure">{t('Assistant simulé. Aucune donnée transmise à une IA.', 'Simulated assistant. No data is sent to an AI.')}</p>}
      </>}
    </div>
  </section>;

  const shownSections = variant === 'C' && !fullDocument && quote.sections.length ? quote.sections.filter(s => s.id === activeSection) : quote.sections;
  function renderLine(line: QuoteLine) {
    const index = quote.lines.findIndex(l => l.id === line.id), cents = lineCents(line);
    return <div className={`qp-line ${changed.includes(line.id) ? 'qp-line-changed' : ''}`} id={`line-${line.id}`} key={line.id}>
      <div className="qp-line-content" lang="fr"><span className="qp-line-number">{String(index + 1).padStart(2, '0')}</span><div className="qp-line-description">{line.description || <span className="qp-missing">Description à compléter</span>}{changed.includes(line.id) && <span className="qp-changed-label" lang={locale}><Check />{t('Modifié', 'Changed')}</span>}</div>
        <div className="qp-line-pricing">{line.mode === 'fixed' ? <span>Forfait</span> : <><span>{line.quantity || '—'} {line.unit || '—'}</span><span>× {line.unitPrice || '—'}</span></>}<strong>{money(cents)}</strong>{cents === null && <span className="qp-missing">À compléter</span>}{cents === 0n && <span>Sans frais</span>}</div>
      </div>
      {!readOnly && <div className="qp-line-actions" lang={locale}>
        <Button variant="ghost" size="sm" onClick={() => edit(line)} aria-label={`${t('Modifier la ligne', 'Edit line')} ${index + 1}`}><Pencil data-icon="inline-start" />{t('Modifier', 'Edit')}</Button>
        <Button variant="ghost" size="icon-sm" aria-label={`${t('Dupliquer la ligne', 'Duplicate line')} ${index + 1}`} onClick={() => { const next = clone(quote), copy = { ...line, id: `copy-${Date.now()}` }; next.lines.splice(index + 1, 0, copy); apply(next, [copy.id]); }}><Copy /></Button>
        <Button variant="ghost" size="icon-sm" disabled={index === 0} aria-label={`${t('Monter la ligne', 'Move up line')} ${index + 1}`} onClick={() => moveLine(line, -1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" disabled={index === quote.lines.length - 1} aria-label={`${t('Descendre la ligne', 'Move down line')} ${index + 1}`} onClick={() => moveLine(line, 1)}><ArrowDown /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`${t('Supprimer la ligne', 'Delete line')} ${index + 1}`} onClick={() => apply({ ...quote, lines: quote.lines.filter(l => l.id !== line.id) })}><Trash2 /></Button>
      </div>}
    </div>;
  }
  const quoteDocument = <section className="qp-document-pane" aria-label={t('Devis destiné au client', 'Customer-facing Quote')}>
    <div className="qp-document-tools"><span><FileText />{t('Le devis', 'The Quote')}<span className="qp-french-label">FR · CHF</span></span><div>{variant === 'C' && <Button variant="ghost" size="sm" onClick={() => setFullDocument(x => !x)}>{fullDocument ? t('Section seule', 'Section only') : t('Tout le devis', 'Full Quote')}</Button>}{!readOnly && <Button variant="ghost" size="sm" onClick={() => openModal('details')}><Settings2 data-icon="inline-start" />{t('Coordonnées et conditions', 'Details & terms')}</Button>}{variant === 'B' && !readOnly && <Button variant="ghost" size="icon-sm" aria-label={quote.sections.length ? t('Organiser les sections', 'Organise sections') : t('Ajouter une section', 'Add a section')} onClick={() => openModal('sections')}><List /></Button>}</div></div>
    {quote.sections.length > 0 && <div className={`qp-jump ${variant !== 'A' ? 'qp-jump-narrow' : ''}`}><label htmlFor="section-jump">{t('Aller à', 'Jump to')}</label><select id="section-jump" value={activeSection} onChange={e => { setSectionId(e.target.value); document.getElementById(`section-${e.target.value}`)?.scrollIntoView({ block: 'start' }); }}>{quote.sections.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select><Button variant="ghost" size="icon-sm" aria-label={t('Organiser les sections', 'Organise sections')} onClick={() => openModal('sections')} disabled={readOnly}><List /></Button></div>}
    <div key={recordId} className="qp-document-scroll" role="region" tabIndex={0} aria-label={t('Contenu du devis, défilant', 'Scrollable Quote content')}>
      {!readOnly && (sum.missing > 0 || missingAdmin) && <div className="qp-editor-guidance"><TriangleAlert /><div><strong>{sum.missing > 0 ? t(`${sum.missing} lignes à compléter`, `${sum.missing} lines need details`) : t('Coordonnées à compléter', 'Details need completing')}</strong><p>{sum.missing > 0 ? t('Le total définitif attend les valeurs manquantes.', 'The final total is withheld until values are complete.') : t('Les montants sont calculés, mais les coordonnées restent à renseigner.', 'Amounts are calculated, but contact details are still missing.')}</p></div><Button variant="ghost" size="sm" onClick={() => missingLines[0] ? reveal(missingLines[0].id) : openModal('details')}>{t('Voir', 'View')}</Button></div>}
      {readOnly && <div className="qp-editor-guidance qp-published-note"><LockKeyhole /><p>{t('Révision figée. Publication sans envoi au destinataire.', 'Frozen revision. Publication did not send this Quote.')}</p></div>}
      <article className="qp-paper" lang="fr">
        <header className="qp-paper-header"><div className="qp-business-name">{quote.businessName || 'Entreprise à renseigner'}</div><div className="qp-paper-meta"><span>Devis {quote.reference}</span><span>{quote.issueDate}</span></div></header>
        <div className="qp-document-title"><h2>{quote.title || 'Nouveau devis'}</h2><p>{quote.siteAddress}</p></div>
        {(variant !== 'C' || fullDocument || !quote.lines.length) && <div className="qp-addresses"><div><span>Proposé par</span><strong>{quote.businessName}</strong><p>{quote.businessAddress}</p><p>{quote.businessContact}</p></div><div><span>À l’attention de</span><strong>{quote.customerName || 'Destinataire à renseigner'}</strong><p>{quote.customerAddress || 'Adresse à renseigner'}</p></div></div>}
        {!quote.lines.length && <div className="qp-empty-document"><FileText /><h2>Les travaux apparaîtront ici.</h2><p>Commencez par une description dans la conversation, ou ajoutez une ligne manuellement.</p></div>}
        {quote.lines.filter(l => !l.sectionId).map(renderLine)}
        {shownSections.map(section => {
          const lines = quote.lines.filter(l => l.sectionId === section.id), incomplete = lines.some(l => lineCents(l) === null);
          const subtotal = lines.reduce((n, l) => n + (lineCents(l) ?? 0n), 0n);
          return <section className="qp-quote-section" id={`section-${section.id}`} key={section.id}>
            <div className="qp-section-title"><h3>{section.title}</h3><span>CHF</span></div>
            {lines.map(renderLine)}
            <div className="qp-section-subtotal"><span>{incomplete ? 'Sous-total partiel' : 'Sous-total'}</span><strong>{money(subtotal)}</strong></div>
          </section>;
        })}
        {!readOnly && <div className="qp-add-line"><Button variant="outline" onClick={() => edit({ id: `new-${Date.now()}`, sectionId: activeSection, description: '', mode: 'quantity', quantity: '', unit: 'm²', unitPrice: '', amount: '' })}><Plus data-icon="inline-start" />{t('Ajouter une ligne', 'Add a line')}</Button></div>}
        <div className="qp-totals">
          <div><span>{sum.missing ? 'Sous-total partiel HT' : 'Sous-total HT'}</span><span>{money(sum.subtotal)}</span></div>
          {quote.discountMode !== 'none' && <div><span>Remise {quote.discountMode === 'percent' ? `${quote.discount} %` : 'CHF'}</span><span>{sum.missing || !sum.validDiscount ? '—' : `− ${money(sum.discount)}`}</span></div>}
          {quote.vatRegistered && <div><span>TVA 8,1 %</span><span>{sum.total === null ? '—' : money(sum.vat)}</span></div>}
          <div className="qp-total"><strong>{sum.total === null ? 'Total à compléter' : 'Total CHF'}</strong><strong>{money(sum.total)}</strong></div>
          {!sum.validDiscount && <p className="qp-missing">La remise doit être comprise entre zéro et le sous-total.</p>}
        </div>
        <footer className="qp-terms"><h3>Conditions</h3><p>{quote.terms || 'Conditions à renseigner'}</p>{quote.validUntil && <p>Offre valable jusqu’au {quote.validUntil}.</p>}{quote.vatRegistered && <p>{quote.vatId}</p>}</footer>
      </article>
      <p className="qp-document-caption">{t('Contenu commercial en français, quelle que soit la langue de l’interface.', 'Commercial content stays in French, independently of the interface language.')}</p>
    </div>
    <div className="qp-document-bottom"><span>{sum.missing ? t('Chiffrage partiel', 'Partially priced') : t('Total du devis', 'Quote total')}</span><strong>CHF {money(sum.total ?? sum.subtotal)}</strong></div>
  </section>;

  return <div className={`qp-app qp-variant-${variant.toLowerCase()}`} data-narrow-panel={narrowPanel} lang={locale}>
    <header className="qp-app-header"><div className="qp-brand-group"><button className="qp-wordmark" onClick={() => { setList(true); setEmptyList(false); }}>easy<span>quote</span><span className="qp-brand-dot">.</span></button><span className="qp-header-divider" /><Button variant="ghost" onClick={() => { setList(true); setEmptyList(false); }}><ArrowLeft data-icon="inline-start" />{t('Mes devis', 'My Quotes')}</Button></div><div className="qp-project-heading"><span>{quote.reference}</span><strong>{quote.title || t('Nouveau devis', 'New Quote')}</strong></div><div className="qp-header-end"><span className="qp-business-label">{t('Atelier de démonstration', 'Demo workshop')}</span><select aria-label="Interface language / Langue de l’interface" value={locale} onChange={e => { const p = new URLSearchParams(params); p.set('lang', e.target.value); setParams(p, { replace: true, preventScrollReset: true }); }}><option value="fr">FR</option><option value="en">EN</option></select><span className="qp-avatar" aria-hidden="true">AT</span></div></header>
    <aside className="qp-prototype-notice" aria-label={t('À propos du prototype', 'About this prototype')}><span>{t('Prototype de design', 'Design prototype')} · {t('Données fictives · Rien n’est conservé après rechargement.', 'Fictional data · Nothing survives a reload.')}</span><Button variant="ghost" size="sm" onClick={() => openModal('scenarios')}>{t('Scénarios et état', 'Scenarios & state')}<Settings2 data-icon="inline-end" /></Button></aside>
    {list ? <main className="qp-quote-list"><div className="qp-list-heading"><div><p>{t('Votre atelier', 'Your workshop')}</p><h1>{t('Mes devis', 'My Quotes')}</h1></div><Button onClick={() => loadSample('empty')}><Plus data-icon="inline-start" />{t('Nouveau devis', 'New Quote')}</Button></div><label className="qp-search-label">{t('Rechercher un devis', 'Search Quotes')}<Input value={listFilter} onChange={e => setListFilter(e.target.value)} placeholder={t('Projet ou destinataire', 'Project or Customer')} /></label>{emptyList ? <div className="qp-list-empty"><FileText /><h2>{t('Votre premier devis commence ici.', 'Your first Quote starts here.')}</h2><p>{t('Décrivez les travaux. Les coordonnées pourront attendre.', 'Describe the work. Contact details can wait.')}</p><Button onClick={() => loadSample('empty')}>{t('Créer un devis', 'Create a Quote')}</Button></div> : <div className="qp-list-rows">{allRecords.filter(r => { const q = r.draft ?? r.revisions.at(-1)!; return `${q.title} ${q.customerName}`.toLowerCase().includes(listFilter.toLowerCase()); }).map(record => { const q = record.draft ?? record.revisions.at(-1)!; return <button className="qp-list-row" key={record.id} onClick={() => openRecord(record)}><FileText /><div><strong>{q.title || t('Nouveau devis', 'New Quote')}</strong><span>{q.customerName || t('Sans destinataire', 'No Customer')} · {q.reference}</span></div><Badge variant="outline">{record.draft ? t('Brouillon', 'Draft') : t(`Révision ${record.revisions.length}`, `Revision ${record.revisions.length}`)}</Badge><span className="qp-list-price">CHF {money(totals(q).total)}</span><ArrowRight /></button>; })}</div>}<p className="qp-list-footnote">{t('La réouverture est simulée en mémoire dans cet onglet.', 'Reopening is simulated in memory in this tab.')}</p></main> : <main className="qp-workspace"><h1 className="sr-only">{t('Préparer un devis', 'Prepare a Quote')}</h1><div className="qp-narrow-tabs"><Button variant={narrowPanel === 'chat' ? 'secondary' : 'ghost'} onClick={() => setNarrowPanel('chat')} aria-pressed={narrowPanel === 'chat'}><MessageSquare data-icon="inline-start" />{t('Conversation', 'Conversation')}</Button><Button variant={narrowPanel === 'quote' ? 'secondary' : 'ghost'} onClick={() => setNarrowPanel('quote')} aria-pressed={narrowPanel === 'quote'}><FileText data-icon="inline-start" />{t('Devis', 'Quote')}</Button></div>{variant === 'A' ? <VariantA chat={chat} document={quoteDocument} outline={outline} toolbar={toolbar} /> : variant === 'B' ? <VariantB chat={chat} document={quoteDocument} outline={outline} toolbar={toolbar} showOutline={showOutline} hasSections={quote.sections.length > 0} /> : <VariantC chat={chat} document={quoteDocument} outline={outline} toolbar={toolbar} />}</main>}
    <PrototypeSwitcher />
    {editLine && <LineEditor line={editLine} sections={quote.sections} locale={locale} onClose={closeModal} onApply={line => { const exists = quote.lines.some(l => l.id === line.id); const next = { ...quote, lines: exists ? quote.lines.map(l => l.id === line.id ? line : l) : [...quote.lines, line] }; next.lines.sort((a, b) => quote.sections.findIndex(s => s.id === a.sectionId) - quote.sections.findIndex(s => s.id === b.sectionId)); apply(next, [line.id]); closeModal(); }} />}
    {modal === 'details' && <ManualEditor quote={quote} locale={locale} lockedReference={revisions.length > 0} onClose={closeModal} onApply={q => { apply(q); closeModal(); }} />}
    {(modal === 'publish' || modal === 'sections' || modal === 'scenarios') && <Dialog open onOpenChange={open => { if (!open) closeModal(); }}><DialogContent className="qp-modal" showCloseButton={false} onCloseAutoFocus={e => { e.preventDefault(); returnFocus.current?.focus(); }}><DialogHeader><DialogTitle>{modal === 'publish' ? t('Relire avant publication', 'Review before publication') : modal === 'sections' ? t('Organiser les sections', 'Organise sections') : t('Scénarios de démonstration', 'Demo scenarios')}</DialogTitle><DialogDescription>{modal === 'publish' ? t('La publication fige le contenu. Elle n’envoie pas le devis.', 'Publication freezes the content. It does not send the Quote.') : modal === 'sections' ? t('Déplacez une section avec ses lignes. Toute modification peut être annulée.', 'Move a section with its lines. Changes can be undone.') : t('Assistant et enregistrement simulés. Aucune donnée transmise à une IA. Recharger efface toutes les modifications.', 'Simulated assistant and saving. No data is sent to an AI. Reloading clears all changes.')}</DialogDescription></DialogHeader>
      {modal === 'publish' && <><div className="qp-publication-summary"><FileText /><h2>{quote.title}</h2><p>{quote.customerName || t('Destinataire manquant', 'Missing Customer')}</p><strong>CHF {money(sum.total)}</strong><p>{quote.reference} · {t('Révision', 'Revision')} {revisions.length + 1}</p></div><ul className="qp-publication-checks"><li>{sum.total !== null ? <Check /> : <TriangleAlert />}{t('Toutes les lignes sont chiffrées', 'Every line is priced')}</li><li>{!missingAdmin ? <Check /> : <TriangleAlert />}{t('Coordonnées et informations requises', 'Contact details and required information')}</li><li>{save === 'saved' ? <Check /> : <TriangleAlert />}{t('Modifications enregistrées', 'Changes saved')}</li><li>{ai !== 'processing' ? <Check /> : <TriangleAlert />}{t('Aucune modification IA en attente', 'No AI change pending')}</li></ul>{blocked ? <Alert><TriangleAlert /><AlertTitle>{t('Publication indisponible', 'Publication unavailable')}</AlertTitle><AlertDescription>{t('Complétez les points signalés puis revenez à cette relecture.', 'Complete the flagged points, then return to this review.')}</AlertDescription></Alert> : <p>{t('Cette révision ne pourra être ni modifiée ni annulée. Une correction nécessitera une nouvelle révision.', 'This revision cannot be edited or undone. A correction requires a new revision.')}</p>}<div className="qp-modal-actions"><Button variant="outline" onClick={closeModal}>{t('Retour au devis', 'Back to Quote')}</Button><Button disabled={blocked} onClick={publish}><LockKeyhole data-icon="inline-start" />{t('Confirmer la publication', 'Confirm publication')}</Button></div></>}
      {modal === 'sections' && <><div className="qp-section-editor">{quote.sections.map((section, i) => <div key={section.id}><Input aria-label={`${t('Nom de section', 'Section name')} ${i + 1}`} value={section.title} onChange={e => apply({ ...quote, sections: quote.sections.map(s => s.id === section.id ? { ...s, title: e.target.value } : s) })} /><div className="qp-section-controls"><Button variant="ghost" size="icon" disabled={i === 0} aria-label={t('Monter la section', 'Move section up')} onClick={() => { const next = clone(quote); [next.sections[i], next.sections[i - 1]] = [next.sections[i - 1], next.sections[i]]; next.lines.sort((a, b) => next.sections.findIndex(s => s.id === a.sectionId) - next.sections.findIndex(s => s.id === b.sectionId)); apply(next); }}><ArrowUp /></Button><Button variant="ghost" size="icon" disabled={i === quote.sections.length - 1} aria-label={t('Descendre la section', 'Move section down')} onClick={() => { const next = clone(quote); [next.sections[i], next.sections[i + 1]] = [next.sections[i + 1], next.sections[i]]; next.lines.sort((a, b) => next.sections.findIndex(s => s.id === a.sectionId) - next.sections.findIndex(s => s.id === b.sectionId)); apply(next); }}><ArrowDown /></Button><Button variant="ghost" size="icon" aria-label={t('Dupliquer la section', 'Duplicate section')} onClick={() => { const id = `section-${Date.now()}`, next = clone(quote); next.sections.push({ id, title: `${section.title} · copie` }); const copies = quote.lines.filter(l => l.sectionId === section.id).map((l, j) => ({ ...l, id: `${id}-${j}`, sectionId: id })); next.lines.push(...copies); apply(next, copies.map(l => l.id)); }}><Copy /></Button><Button variant="ghost" size="icon" aria-label={t('Supprimer la section et ses lignes', 'Delete section and its lines')} onClick={() => apply({ ...quote, sections: quote.sections.filter(s => s.id !== section.id), lines: quote.lines.filter(l => l.sectionId !== section.id) })}><Trash2 /></Button></div></div>)}</div><div className="qp-modal-actions"><Button variant="outline" onClick={() => apply({ ...quote, sections: [...quote.sections, { id: `section-${Date.now()}`, title: 'Nouvelle section' }] })}><Plus data-icon="inline-start" />{t('Ajouter', 'Add')}</Button><Button onClick={closeModal}>{t('Terminer', 'Done')}</Button></div></>}
      {modal === 'scenarios' && <><div className="qp-scenario-grid"><Button variant="outline" onClick={() => loadSample('joinery')}>{t('30 lignes · incomplet', '30 lines · incomplete')}</Button><Button variant="outline" onClick={() => loadSample('complete')}>{t('30 lignes · complet', '30 lines · complete')}</Button><Button variant="outline" onClick={() => loadSample('flat')}>{t('Devis simple · 14 lignes', 'Flat Quote · 14 lines')}</Button><Button variant="outline" onClick={() => { setList(true); setEmptyList(true); closeModal(); }}>{t('Liste vide', 'Empty list')}</Button></div><FieldGroup><Field><FieldLabel htmlFor="failure">{t('Prochaine action simulée', 'Next simulated action')}</FieldLabel><select id="failure" value={failure} onChange={e => setFailure(e.target.value as typeof failure)}><option value="none">{t('Fonctionnement normal', 'Normal operation')}</option><option value="ai">{t('Échec de l’assistant', 'Assistant failure')}</option><option value="save">{t('Échec de l’enregistrement', 'Save failure')}</option><option value="slow">{t('IA lente · éditez pendant l’attente', 'Slow AI · edit while waiting')}</option></select></Field></FieldGroup><p>{t('Choisissez un échec, puis lancez une demande de démonstration. Une IA lente laisse 9 secondes pour modifier une ligne et observer le rejet de la réponse obsolète.', 'Choose a failure, then run a demo request. Slow AI gives you 9 seconds to edit a line and observe stale-response rejection.')}</p>{variant === 'B' && !readOnly && <section aria-label={t('Demandes de démonstration', 'Demo requests')}><h3>{t('Demandes de démonstration', 'Demo requests')}</h3><div className="qp-prompt-examples">{exampleRequests}</div></section>}<details className="qp-state-inspector"><summary>{t('État complet du prototype', 'Full prototype state')}</summary><pre>{JSON.stringify({ variant, locale, quote, messages, readRevision, revisions, draft, save, ai, failure, changed, undoAvailable: !!previous, activeSection, fullDocument, outlineCollapsed, showOutline, records }, null, 2)}</pre></details><Button onClick={closeModal}>{t('Revenir au prototype', 'Back to prototype')}</Button></>}
    </DialogContent></Dialog>}
  </div>;
}
