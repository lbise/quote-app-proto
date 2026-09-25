import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, CheckCheck, FileText, LockKeyhole, MessageSquare, PanelLeftClose, PanelLeftOpen, PanelRightClose, Pencil, Plus, RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { EditAffordance } from './edit-affordance';
import { LineActions } from './line-actions';
import { Message, MessageContent, MessageHeader } from '../ui/message';
import { Bubble, BubbleContent } from '../ui/bubble';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from '../ui/message-scroller';
import { appendQuoteLineToSection, calculateQuote, money, type QuoteLine } from '../../lib/quote';
import { quoteLineId, randomUUID } from '../../lib/random-id';
import { addQuoteSection, duplicateQuoteSection, moveQuoteSection, removeQuoteSection, renameQuoteSection } from '../../lib/quote-section-operations';
import { LineEditor } from './manual-editor';
import { BusinessQuoteEditor, DiscountQuoteEditor, QuoteMetadataPopover, SiteQuoteEditor, TermsQuoteEditor } from './quote-detail-editors';
import { CustomerQuoteEditor } from './customer-quote-editor';
import { RecordsEditor } from './records-editor';
import { AddSectionControl, SectionHeading } from './section-preview-controls';
import { useQuote, type QuoteRecord } from './use-quote';
import { QuoteHeader } from './quote-header';
import { AssistantDisclosure } from './assistant-disclosure';
import { AssistantDebug } from './assistant-debug';
import { AssistantMarkdown } from './assistant-markdown';
import { problemLabel } from './problem-label';
import { MissingWarning, QuoteField } from './quote-validation';
import type { QuoteAIDisclosure } from '../../lib/quote-ai-disclosure';
import { useBlocker, useRouteLoaderData } from 'react-router';

const clone = <T,>(value: T): T => structuredClone(value);
const formatMoney = (value: number | null) => value === null ? '—' : money(value).replace(/\u202f/g, '’').replace(/\u00a0CHF$/, '');

export default function QuoteWorkspace({ initial, locale, onList, onLanguage }: { initial: QuoteRecord; locale: 'en' | 'fr'; onList: () => void; onLanguage: (locale: 'en' | 'fr') => void }) {
  const state = useQuote(initial);
  const { quoteAI } = useRouteLoaderData('root') as { quoteAI: QuoteAIDisclosure };
  const { record, save, ai, error, debug, toolDebug, changed, changedFields, busy, apply, flush, mutate, applyCustomer, lastRequest } = state;
  const [readRevision, setReadRevision] = useState<number | null>(initial.draft ? null : initial.revisions.length - 1);
  const [input, setInput] = useState('');
  const [editLine, setEditLine] = useState<QuoteLine | null>(null);
  const [focusField, setFocusField] = useState<string | undefined>();
  const [modal, setModal] = useState<'business' | 'customer' | 'site' | 'discount' | 'terms' | 'publish' | 'records' | 'privacy' | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [insertion, setInsertion] = useState<string | null>(null);
  const insertionTrigger = useRef<HTMLButtonElement | null>(null);
  const documentAddTrigger = useRef<HTMLButtonElement | null>(null);
  const addMenuAction = useRef<'line' | 'section' | null>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [narrowPanel, setNarrowPanel] = useState<'chat' | 'quote'>('chat');
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const showAssistantButton = useRef<HTMLButtonElement | null>(null);
  const hideAssistantButton = useRef<HTMLButtonElement | null>(null);
  const documentScroll = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const metadataTrigger = useRef<HTMLButtonElement | null>(null);
  const returnLineId = useRef<string | null>(null);
  const quote = readRevision === null ? state.quote : record.revisions[readRevision].quote;
  const revisions = record.revisions, messages = record.messages, recordId = record.id;
  const readOnly = readRevision !== null;
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const calculation = readRevision === null ? calculateQuote(quote) : record.revisions[readRevision].calculation;
  const lineAmounts = new Map(calculation.lines.map(line => [line.id, line.amount]));
  const amountFor = (line: QuoteLine) => lineAmounts.get(line.id) ?? null;
  const sum = { ...calculation, missing: calculation.lines.filter(l => l.amount === null).length, validDiscount: !calculation.errors.some(e => e.path.startsWith('discount')) && !calculation.missing.some(e => e.path.startsWith('discount')) };
  const missingAdmin = calculation.missing.some(e => !e.path.startsWith('lines')) || calculation.errors.length > 0;
  const blocked = !calculation.complete || save !== 'saved' || ai === 'processing' || busy;
  const showOutline = quote.sections.length > 0 && !outlineCollapsed;
  const activeSection = quote.sections.some(s => s.id === sectionId) ? sectionId : quote.sections[0]?.id || '';
  const problems = [...calculation.errors, ...calculation.missing];
  const problemLines = calculation.lines.filter((_, index) => problems.some(problem => problem.path.startsWith(`lines[${index}].`)));
  const blocker = useBlocker(save !== 'saved');

  useEffect(() => {
    try {
      setAssistantCollapsed(localStorage.getItem('easy-quote-assistant-collapsed') === 'true');
    } catch { /* Storage may be unavailable; the assistant remains usable. */ }
  }, []);

  function toggleAssistant(collapsed: boolean) {
    setAssistantCollapsed(collapsed);
    try { localStorage.setItem('easy-quote-assistant-collapsed', String(collapsed)); }
    catch { /* Keep the choice for this visit when persistence is unavailable. */ }
    requestAnimationFrame(() => (collapsed ? showAssistantButton : hideAssistantButton).current?.focus({ preventScroll: true }));
  }

  // Keep the outline aligned with manual scrolling, not only section clicks.
  useEffect(() => {
    const root = documentScroll.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!root.clientHeight) return;
        const top = root.getBoundingClientRect().top + 40;
        const sections = [...root.querySelectorAll<HTMLElement>('.qp-quote-section')];
        const current = sections.filter(section => section.getBoundingClientRect().top <= top).at(-1) ?? sections[0];
        if (current) setSectionId(current.id.slice('section-'.length));
      });
    };
    root.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(root);
    update();
    return () => { cancelAnimationFrame(frame); root.removeEventListener('scroll', update); observer.disconnect(); };
  }, [quote.sections, readRevision]);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm(t('Des modifications ne sont pas enregistrées. Quitter quand même ?', 'Changes are not saved. Leave anyway?'))) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, locale]);

  function closeModal() {
    setModal(null); setEditLine(null);
    setTimeout(() => {
      const target = returnFocus.current;
      const lineTarget = returnLineId.current && document.getElementById(`line-${returnLineId.current}`)?.querySelector<HTMLElement>('button');
      returnLineId.current = null;
      if (target?.isConnected && target.getClientRects().length > 0) target.focus({ preventScroll: true });
      else if (lineTarget) lineTarget.focus({ preventScroll: true });
      else if (document.querySelector<HTMLElement>('.qp-add-section button')) document.querySelector<HTMLElement>('.qp-add-section button')?.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('.qp-document-scroll')?.focus({ preventScroll: true });
    }, 0);
  }
  function openModal(name: typeof modal, field?: string) { setFocusField(field); returnLineId.current = null; returnFocus.current = document.activeElement as HTMLElement; setModal(name); }
  function edit(line: QuoteLine, field?: string) { setFocusField(field); returnLineId.current = line.id; returnFocus.current = document.activeElement as HTMLElement; setEditLine(clone(line)); }
  function reveal(id: string, focusEdit = false) {
    const line = quote.lines.find(l => l.id === id);
    if (line) setSectionId(line.sectionId);
    setNarrowPanel('quote');
    setTimeout(() => {
      const target = document.getElementById(`line-${id}`);
      target?.scrollIntoView({ block: 'center' });
      if (focusEdit) target?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    }, 0);
  }
  function revealField(field: string) {
    setNarrowPanel('quote');
    if (field.startsWith('section:')) {
      const id = `section-${field.slice(8)}`;
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center' }), 0);
      return;
    }
    const lineMatch = /^lines\[(\d+)\]\.(.+)$/.exec(field);
    const sectionMatch = /^sections\[(\d+)\]\.(.+)$/.exec(field);
    if (lineMatch) {
      const line = calculation.quote?.lines[Number(lineMatch[1])];
      if (line) { reveal(line.id); edit(line, lineMatch[2]); }
      return;
    }
    if (sectionMatch) {
      const section = quote.sections[Number(sectionMatch[1])];
      setTimeout(() => document.getElementById(`section-${section?.id}`)?.querySelector<HTMLButtonElement>('.qp-section-rename-trigger')?.click(), 0);
      return;
    }
    if (field === 'lines') { addLine(''); return; }
    if (field === 'title') { setTitleDraft(quote.title); setEditingTitle(true); }
    else if (field === 'discount' || field === 'discountMode') openModal('discount', field);
    else if (field === 'siteAddress') openModal('site', field);
    else if (field.startsWith('customer')) openModal('customer', field);
    else if (field.startsWith('business') || field.startsWith('vat')) openModal('business', field);
    else if (field === 'terms') openModal('terms', field);
    else if (field === 'reference' || field === 'issueDate' || field === 'validUntil') { setFocusField(field); setTimeout(() => metadataTrigger.current?.click(), 0); }
    setTimeout(() => document.getElementById(field === 'discount' ? 'quote-totals' : 'quote-title')?.scrollIntoView({ block: 'center' }), 0);
  }
  function moveLine(line: QuoteLine, delta: number) {
    const next = clone(quote), i = next.lines.findIndex(l => l.id === line.id), j = i + delta;
    if (i < 0 || j < 0 || j >= next.lines.length || next.lines[j].sectionId !== line.sectionId) return;
    [next.lines[i], next.lines[j]] = [next.lines[j], next.lines[i]];
    apply(next, [line.id]);
    setTimeout(() => document.getElementById(`line-${line.id}`)?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
  }
  function addLine(sectionId: string) {
    edit({ id: quoteLineId(), sectionId, description: '', mode: 'quantity', quantity: '', unit: 'm²', unitPrice: '', amount: '' });
  }
  function beginSection(afterId: string, trigger: HTMLButtonElement | null) {
    insertionTrigger.current = trigger;
    setInsertion(afterId);
    setTimeout(() => document.getElementById(`new-section-${afterId}`)?.scrollIntoView({ block: 'nearest' }), 0);
  }
  function cancelSection() {
    setInsertion(null);
    requestAnimationFrame(() => insertionTrigger.current?.focus({ preventScroll: true }));
  }
  function addSection(afterId: string | null, title: string) {
    setInsertion(null);
    const id = `section-${randomUUID()}`;
    apply(addQuoteSection(quote, afterId, id, title));
    setSectionId(id);
    setTimeout(() => document.getElementById(`section-${id}`)?.querySelector<HTMLButtonElement>('.qp-section-rename-trigger')?.focus({ preventScroll: true }), 0);
  }
  function removeSection(id: string, deleteLines: boolean) {
    const firstLine = quote.lines.find(line => line.sectionId === id)?.id;
    const nextSection = quote.sections.find((section, index) => quote.sections[index - 1]?.id === id)?.id ?? quote.sections.find(section => section.id !== id)?.id ?? '';
    apply(removeQuoteSection(quote, id, deleteLines));
    setSectionId(nextSection);
    setTimeout(() => {
      const target = !deleteLines && firstLine ? document.getElementById(`line-${firstLine}`)?.querySelector<HTMLElement>('button') : null;
      (target ?? (nextSection ? document.getElementById(`section-${nextSection}`)?.querySelector<HTMLElement>('.qp-section-rename-trigger') : null) ?? document.querySelector<HTMLElement>('.qp-add-section button'))?.focus({ preventScroll: true });
    }, 0);
  }
  function deleteLine(line: QuoteLine) {
    const index = quote.lines.indexOf(line);
    const remaining = quote.lines.filter(l => l.id !== line.id);
    apply({ ...quote, lines: remaining });
    setTimeout(() => {
      const next = remaining[Math.min(index, remaining.length - 1)];
      const target = next ? document.getElementById(`line-${next.id}`)?.querySelector<HTMLButtonElement>('button') : document.querySelector<HTMLButtonElement>('.qp-add-line button');
      target?.focus();
    }, 0);
  }
  async function sendMessage(text: string, retry = false) {
    setInput('');
    const next = await state.runAssistant(text, locale, retry);
    showAssistantResult(next);
  }
  function showAssistantResult(next: QuoteRecord | null) {
    const id = next?.messages.at(-1)?.changed?.[0];
    if (id) reveal(id);
    else if (next?.messages.at(-1)?.changedFields?.[0]) revealField(next.messages.at(-1)!.changedFields![0]);
  }
  async function publish() {
    if (blocked) return;
    const next = await mutate('publish');
    if (next) { setReadRevision(next.revisions.length - 1); closeModal(); }
  }
  async function newRevision() {
    if (record.draft) { setReadRevision(null); return; }
    if (await mutate('new-draft')) setReadRevision(null);
  }
  const status = <span className={`qp-save qp-save-${save}`} role="status">{save === 'saved' ? <CheckCheck /> : save === 'error' ? <TriangleAlert /> : <span className="qp-spinner" />}{save === 'saved' ? t('Enregistré', 'Saved') : save === 'saving' ? t('Enregistrement…', 'Saving…') : t('Non enregistré', 'Not saved')}{save === 'error' && <Button size="sm" variant="ghost" onClick={() => void flush()}>{t('Réessayer', 'Retry')}</Button>}</span>;
  const toolbar = <div className="qp-work-toolbar">
    <div className="qp-document-status"><Badge variant={readOnly ? 'secondary' : 'outline'}>{readOnly ? <LockKeyhole data-icon="inline-start" /> : <Pencil data-icon="inline-start" />}{readOnly ? t(`Révision publiée ${readRevision + 1}`, `Published revision ${readRevision + 1}`) : t('Brouillon de travail', 'Working draft')}</Badge>{!readOnly && status}</div>
    <div className="qp-toolbar-actions">
      {revisions.length > 0 && <select aria-label={t('Version du devis', 'Quote version')} value={readRevision === null ? 'draft' : String(readRevision)} onChange={e => setReadRevision(e.target.value === 'draft' ? null : Number(e.target.value))} disabled={save !== 'saved' || ai === 'processing' || busy}>{record.draft && <option value="draft">{t('Brouillon', 'Draft')}</option>}{revisions.map((r, i) => <option key={r.number} value={i}>{t('Révision', 'Revision')} {r.number}</option>)}</select>}
      {!readOnly && <Button variant="ghost" disabled={!record.canUndo || save !== 'saved' || busy || ai === 'processing'} onClick={() => void mutate('undo')} className="qp-undo" aria-label={t('Annuler la dernière modification', 'Undo last change')} title={t('Annuler la dernière modification', 'Undo last change')}><RotateCcw data-icon="inline-start" /><span>{t('Annuler la dernière modification', 'Undo last change')}</span></Button>}
      {readOnly ? <Button disabled={busy} onClick={() => void newRevision()}><Pencil data-icon="inline-start" />{record.draft ? t('Reprendre', 'Resume draft') : t('Nouvelle révision', 'New revision')}</Button> : <Button onClick={() => openModal('publish')}><Check data-icon="inline-start" />{t('Relire et publier', 'Review & publish')}</Button>}
    </div>
  </div>;
  const outlineLinks = <>
    {quote.sections.map((section) => { const lines = quote.lines.filter(l => l.sectionId === section.id), missing = lines.some(l => amountFor(l) === null); return <button key={section.id} className={activeSection === section.id ? 'is-current' : ''} aria-current={activeSection === section.id ? 'true' : undefined} onClick={() => { setSectionId(section.id); setNarrowPanel('quote'); setTimeout(() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ block: 'start' }), 0); }}><span>{section.title}</span>{missing ? <TriangleAlert aria-label={t('À compléter', 'Incomplete')} /> : <span>{lines.length}</span>}</button>; })}
  </>;
  const outline = <nav className="qp-outline" aria-label={t('Sections du devis', 'Quote sections')}>
    <div className="qp-outline-heading"><div className="qp-outline-title-row"><span>Sections</span>{<Button variant="ghost" size="icon-sm" aria-label={showOutline ? t('Réduire les sections', 'Collapse sections') : t('Développer les sections', 'Expand sections')} title={showOutline ? t('Réduire les sections', 'Collapse sections') : t('Développer les sections', 'Expand sections')} aria-controls="qp-section-links" aria-expanded={showOutline} onClick={() => setOutlineCollapsed(x => !x)}>{showOutline ? <PanelLeftClose /> : <PanelLeftOpen />}</Button>}</div></div>
    {<div id="qp-section-links" className="qp-outline qp-outline-links" hidden={!showOutline}>{outlineLinks}</div>}
  </nav>;

  const chat = <section id="qp-assistant" className="qp-conversation" aria-label={t('Conversation avec l’assistant', 'Conversation with assistant')}>
    <header className="qp-panel-heading"><div className="qp-assistant-heading"><MessageSquare /><div><h2>{t('Assistant IA', 'AI assistant')}</h2></div></div><div className="qp-assistant-controls"><Button variant="ghost" size="icon-sm" onClick={() => openModal('privacy')} aria-label={t('Données envoyées à l’assistant', 'Assistant data and privacy')} title={t('Données envoyées à l’assistant', 'Assistant data and privacy')}><ShieldCheck /></Button><Button ref={hideAssistantButton} variant="ghost" size="sm" className="qp-assistant-toggle" aria-controls="qp-assistant" aria-expanded={!assistantCollapsed} aria-label={t('Masquer l’assistant', 'Hide assistant')} onClick={() => toggleAssistant(true)}><PanelRightClose data-icon="inline-start" />{t('Masquer', 'Hide')}</Button></div></header>
    <MessageScrollerProvider key={recordId} autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={0}><MessageScroller className="qp-chat-scroller">
      <MessageScrollerViewport><MessageScrollerContent className="qp-chat-content">
        
        {messages.map((message, i) => <MessageScrollerItem key={i} messageId={`message-${i}`} scrollAnchor={message.role === 'artisan'}>
          <Message align={message.role === 'artisan' ? 'end' : 'start'} className={message.role === 'note' ? 'qp-note-message' : ''}><MessageContent>
            <MessageHeader>{message.role === 'artisan' ? t('Vous', 'You') : message.role === 'note' ? t('Historique', 'History') : 'Easy Quote'}</MessageHeader>
            <Bubble variant={message.role === 'artisan' ? 'secondary' : 'ghost'}><BubbleContent>{message.role === 'assistant' ? <AssistantMarkdown text={message[locale]} /> : message[locale]}</BubbleContent></Bubble>
            {!!message.changed?.length && <div className="qp-change-links"><span><Check />{message.changed.length} {t('lignes modifiées', 'lines changed')}</span>{message.changed?.some(id => quote.lines.some(line => line.id === id)) && <Button variant="link" size="sm" onClick={() => reveal(message.changed!.find(id => quote.lines.some(line => line.id === id))!, true)}>{t('Voir dans le devis', 'View in Quote')}<ArrowRight data-icon="inline-end" /></Button>}</div>}
            {!!message.changedFields?.length && <div className="qp-change-links"><span><Check />{t('Détails du devis modifiés', 'Quote details changed')}</span><Button variant="link" size="sm" onClick={() => revealField(message.changedFields![0])}>{t('Voir les détails modifiés', 'View changed details')}<ArrowRight data-icon="inline-end" /></Button></div>}
          </MessageContent></Message>
        </MessageScrollerItem>)}
        {toolDebug && <MessageScrollerItem><AssistantDebug toolDebug={toolDebug} locale={locale} /></MessageScrollerItem>}
        {ai === 'processing' && <MessageScrollerItem><p className="qp-processing" role="status"><span className="qp-spinner" />{t('Je prépare la modification. Vous pouvez continuer à éditer.', 'Preparing the change. You can keep editing.')}</p></MessageScrollerItem>}
        {(ai === 'error' || ai === 'stale') && <MessageScrollerItem><Alert variant="destructive"><TriangleAlert /><AlertTitle>{ai === 'stale' ? t('Votre correction est conservée', 'Your edit is preserved') : t('L’assistant n’a pas répondu', 'The assistant did not respond')}</AlertTitle><AlertDescription><p>{ai === 'stale' ? t('La réponse est devenue obsolète pendant votre modification. Elle n’a pas été appliquée.', 'The response became stale while you edited. It was not applied.') : debug?.code === 'destructive_scope_rejected' ? t('Aucune modification de ce tour n’a été enregistrée. Supprimez les travaux avec les contrôles manuels.', 'Nothing from this turn was saved. Delete the work manually instead.') : debug?.outcome === 'failed_call_limit_reached' ? t('L’assistant s’est arrêté après trois appels d’outil en échec. Aucune modification de cette demande n’a été enregistrée.', 'The assistant stopped after three failed tool calls. No changes from this request were saved.') : debug?.outcome === 'draft_context_too_large' ? t('Ce brouillon complet dépasse la limite de taille de l’assistant. Aucune donnée n’a été transmise au fournisseur.', 'This complete Working Draft exceeds the assistant’s size limit. Nothing was sent to the provider.') : debug?.outcome === 'later_budget_exhausted' ? t('L’assistant a atteint une limite de traitement. Aucune modification de ce tour n’a été enregistrée.', 'The assistant reached a processing limit. Nothing from this turn was saved.') : t('Le devis n’a pas changé. Réessayez ou continuez manuellement.', 'The Quote is unchanged. Retry or continue manually.')}</p>{ai === 'error' && debug && <AssistantDebug debug={debug} locale={locale} />}<Button variant="outline" onClick={() => { void sendMessage(lastRequest.current?.text ?? '', true); }}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert></MessageScrollerItem>}
      </MessageScrollerContent></MessageScrollerViewport>
      <MessageScrollerButton aria-label={t('Dernier message', 'Latest message')} />
    </MessageScroller></MessageScrollerProvider>
    <div className="qp-compose-area">
      {readOnly ? <div className="qp-chat-locked"><LockKeyhole /><p>{t('Cette révision est figée. Créez un brouillon pour poursuivre.', 'This revision is frozen. Create a draft to continue.')}</p></div> : <>
        <form className="qp-composer" onSubmit={e => { e.preventDefault(); void sendMessage(input); }}>
          <label htmlFor="assistant-message">{t('Votre message', 'Your message')}</label>
          <Textarea id="assistant-message" placeholder={t('Ajoutez une précision, un prix, une correction…', 'Add a detail, a price, a correction…')} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
              e.preventDefault();
              const target = e.currentTarget;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              setInput(`${input.slice(0, start)}\n${input.slice(end)}`);
              requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
              return;
            }
            e.preventDefault();
            if (input.trim() && ai !== 'processing') void sendMessage(input);
          }} />
          <div className="qp-composer-footer"><span>{t('Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne', 'Enter to send · Shift + Enter for a new line')}</span><Button type="submit" disabled={!input.trim() || ai === 'processing'} aria-label={t('Envoyer le message', 'Send message')}><ArrowUp /></Button></div>
        </form>
      </>}
    </div>
  </section>;

  function warning(path: string) {
    const problem = !readOnly && calculation.missing.find(problem => problem.path === path);
    return problem ? <MissingWarning key={path} problem={problem} locale={locale} onClick={() => revealField(path)} /> : null;
  }
  function renderLine(line: QuoteLine) {
    const index = quote.lines.findIndex(l => l.id === line.id), cents = amountFor(line);
    const path = `lines[${calculation.lines.findIndex(result => result.id === line.id)}]`;
    const canMoveUp = index > 0 && quote.lines[index - 1].sectionId === line.sectionId;
    const canMoveDown = index >= 0 && index < quote.lines.length - 1 && quote.lines[index + 1].sectionId === line.sectionId;
    return <div className={`qp-line ${changed.includes(line.id) ? 'qp-line-changed' : ''}`} id={`line-${line.id}`} key={line.id} data-testid="quote-line">
      <div className={`qp-line-content${readOnly ? '' : ' qp-line-content-editable'}`} lang="fr"><span className="qp-line-number">{String(index + 1).padStart(2, '0')}</span><div className="qp-line-description">{warning(`${path}.description`) || line.description || <span className="qp-missing">Description à compléter</span>}{changed.includes(line.id) && <span className="qp-changed-label" lang={locale}><Check />{t('Modifié', 'Changed')}</span>}</div>
        <div className="qp-line-pricing">{line.mode === 'fixed' ? <span>Forfait</span> : <><span>{warning(`${path}.quantity`) || line.quantity || '—'} {warning(`${path}.unit`) || line.unit || '—'}</span>{warning(`${path}.unitPrice`) || <span>× {line.unitPrice || '—'}</span>}</>}{line.mode === 'fixed' ? warning(`${path}.amount`) || <strong>{formatMoney(cents)}</strong> : <strong>{formatMoney(cents)}</strong>}{readOnly && cents === null && <span className="qp-missing">À compléter</span>}{cents === 0 && <span>Sans frais</span>}</div>
        {!readOnly && <LineActions number={index + 1} locale={locale} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onEdit={() => edit(line)} onMove={delta => moveLine(line, delta)} onDelete={() => deleteLine(line)} onDuplicate={() => {
          const next = clone(quote), copy = { ...line, id: quoteLineId() };
          next.lines.splice(index + 1, 0, copy);
          apply(next, [copy.id]);
          reveal(copy.id, true);
          return copy.id;
        }} />}
      </div>
    </div>;
  }
  const documentAdd = !readOnly && <DropdownMenu onOpenChange={open => { if (open) addMenuAction.current = null; }}>
    <DropdownMenuTrigger asChild><Button ref={documentAddTrigger} type="button" variant="ghost" size="sm" aria-label={t('Ajouter au devis', 'Add to Quote')}><Plus data-icon="inline-start" />{t('Ajouter', 'Add')}</Button></DropdownMenuTrigger>
    <DropdownMenuContent className="qp-line-menu" align="end" lang={locale} onCloseAutoFocus={event => {
      if (addMenuAction.current) event.preventDefault();
      // Inline creation is outside the menu's focus trap. Focus it after the
      // menu closes rather than relying on mount-time autofocus.
      if (addMenuAction.current === 'section') requestAnimationFrame(() => document.getElementById('new-section-end')?.focus());
    }}><DropdownMenuGroup>
      <DropdownMenuItem onSelect={() => {
        addMenuAction.current = 'line';
        addLine('');
        returnFocus.current = documentAddTrigger.current;
      }}><Plus />{t('Ajouter une ligne sans section', 'Add ungrouped line')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { addMenuAction.current = 'section'; beginSection('end', documentAddTrigger.current); }}><Plus />{t('Ajouter une section', 'Add section')}</DropdownMenuItem>
    </DropdownMenuGroup></DropdownMenuContent>
  </DropdownMenu>;
  const quoteDocument = <section id="qp-quote-document" className="qp-document-pane" aria-label={t('Devis destiné au client', 'Customer-facing Quote')}>
    <div className="qp-document-tools"><span><FileText />{t('Le devis', 'The Quote')}<span className="qp-french-label">FR · CHF</span></span>{quote.sections.length > 0 && <div className="qp-jump qp-jump-narrow"><label htmlFor="section-jump">{t('Aller à', 'Jump to')}</label><select id="section-jump" value={activeSection} onChange={e => { setSectionId(e.target.value); document.getElementById(`section-${e.target.value}`)?.scrollIntoView({ block: 'start' }); }}>{quote.sections.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select></div>}<div className="qp-document-actions">{documentAdd}{assistantCollapsed && <Button ref={showAssistantButton} variant="outline" size="sm" className="qp-assistant-toggle" aria-controls="qp-assistant" aria-expanded={false} onClick={() => toggleAssistant(false)}><MessageSquare data-icon="inline-start" />{t('Afficher l’assistant', 'Show assistant')}{ai === 'processing' && <span className="qp-spinner" aria-label={t('Modification en cours', 'Change in progress')} />}</Button>}</div></div>
    <div ref={documentScroll} key={recordId} className="qp-document-scroll" role="region" tabIndex={0} aria-label={t('Contenu du devis, défilant', 'Scrollable Quote content')}>
      {!readOnly && problems.length > 0 && <div className="qp-editor-guidance"><TriangleAlert /><div aria-live="polite"><strong>{problemLines.length > 0 ? (problemLines.length === 1 ? t('1 ligne à compléter', '1 line needs details') : t(`${problemLines.length} lignes à compléter`, `${problemLines.length} lines need details`)) : t('Informations à compléter', 'Details need completing')}</strong><p>{t('Complétez les champs signalés avant publication.', 'Complete the flagged fields before publication.')}</p></div><Button variant="ghost" size="sm" onClick={() => revealField((problems.find(problem => problem.path.startsWith('lines[')) ?? problems[0]).path)}>{t('Voir', 'View')}</Button></div>}
      {readOnly && <div className="qp-editor-guidance qp-published-note"><LockKeyhole /><p>{t('Révision figée. Publication sans envoi au destinataire.', 'Frozen revision. Publication did not send this Quote.')}</p></div>}
      <article className="qp-paper" lang="fr">
        <header className="qp-paper-header"><div className="qp-business-name">{quote.businessName || 'Entreprise à renseigner'}</div>{readOnly ? <div className="qp-paper-meta"><span>Devis {quote.reference}</span><span>{quote.issueDate}</span></div> : <QuoteMetadataPopover quote={quote} locale={locale} focusField={focusField} lockedReference={revisions.length > 0} onApply={q => apply(q)}><button ref={metadataTrigger} type="button" onPointerDown={() => setFocusField(undefined)} className="qp-paper-meta qp-edit-target" aria-label={t('Modifier la référence et les dates', 'Edit reference and dates')} title={t('Modifier la référence et les dates', 'Edit reference and dates')}><span className="qp-edit-content"><span>Devis {quote.reference || '…'}</span><span>{quote.issueDate || t('Date à renseigner', 'Set issue date')}</span></span><EditAffordance locale={locale} /></button></QuoteMetadataPopover>}{!readOnly && <div className="qp-metadata-warnings">{warning('reference')}{warning('issueDate')}</div>}</header>
        <div className="qp-document-title" id="quote-title">{editingTitle && !readOnly ? <form className="qp-inline-title" onSubmit={e => { e.preventDefault(); apply({ ...quote, title: titleDraft }); setEditingTitle(false); }}><QuoteField calculation={calculateQuote({ ...quote, title: titleDraft })} path="title" id="quote-title-input" locale={locale}><label htmlFor="quote-title-input" className="sr-only">{t('Objet du devis', 'Quote title')}</label><input id="quote-title-input" autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingTitle(false); }} /></QuoteField><Button type="submit" size="sm">{t('Enregistrer', 'Save')}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setEditingTitle(false)}>{t('Annuler', 'Cancel')}</Button></form> : <h2 aria-label={!readOnly ? quote.title || t('Nouveau devis', 'New Quote') : undefined}>{readOnly ? quote.title || 'Nouveau devis' : warning('title') || <button type="button" className="qp-edit-target" onClick={() => { setTitleDraft(quote.title); setEditingTitle(true); }} aria-label={t('Modifier l’objet du devis', 'Edit Quote title')}><span>{quote.title || t('Ajouter un objet', 'Add a title')}</span><EditAffordance locale={locale} /></button>}</h2>}{!readOnly && changedFields.includes('title') && <span className="qp-changed-label" lang={locale}><Check />{t('Objet modifié', 'Title changed')}</span>}{readOnly ? <p>{quote.siteAddress}</p> : <button type="button" className="qp-edit-target qp-site-target" onClick={() => openModal('site')} aria-label={t('Modifier l’adresse du chantier', 'Edit site address')}><span>{quote.siteAddress || t('Ajouter l’adresse du chantier', 'Add site address')}</span><EditAffordance locale={locale} /></button>}</div>
        <div className="qp-addresses"><div><span>Proposé par</span>{readOnly ? <><strong>{quote.businessName}</strong><p>{quote.businessAddress}</p><p>{quote.businessContact}</p></> : <button type="button" className="qp-edit-target qp-address-target" onClick={() => openModal('business')} aria-label={t('Modifier les coordonnées de l’entreprise', 'Edit business details')}><span className="qp-edit-content"><strong>{quote.businessName}</strong><span>{quote.businessAddress}</span><span>{quote.businessContact}</span></span><EditAffordance locale={locale} /></button>}{warning('businessName')}{warning('businessAddress')}{warning('businessContact')}</div><div><span>À l’attention de</span>{readOnly ? <><strong>{quote.customerName || 'Destinataire à renseigner'}</strong><p>{quote.customerAddress || 'Adresse à renseigner'}</p><p>{quote.customerContact}</p></> : <button type="button" className="qp-edit-target qp-address-target" onClick={() => openModal('customer')} aria-label={t('Choisir ou modifier le client', 'Choose or edit Customer')}><span className="qp-edit-content"><strong>{quote.customerName}</strong><span>{quote.customerAddress}</span><span>{quote.customerContact}</span></span><EditAffordance locale={locale} /></button>}{warning('customerName')}{warning('customerAddress')}</div></div>
        {!quote.lines.length && <div className="qp-empty-document"><FileText /><h2>Les travaux apparaîtront ici.</h2><p>Commencez par une description dans la conversation, ou ajoutez une ligne manuellement.</p></div>}
        {quote.lines.filter(l => !l.sectionId).map(renderLine)}
        {quote.sections.map((section, sectionIndex) => {
          const lines = quote.lines.filter(l => l.sectionId === section.id);
          const sectionCalculation = calculation.sections.find(result => result.id === section.id);
          const incomplete = sectionCalculation?.incomplete ?? true;
          const subtotal = sectionCalculation?.subtotal ?? 0;
          return <section className="qp-quote-section" id={`section-${section.id}`} key={section.id}>
            <SectionHeading quote={quote} calculation={calculation} title={section.title} locale={locale} readOnly={readOnly} index={sectionIndex} count={quote.sections.length} lineCount={lines.length} onAddLine={() => addLine(section.id)} onInsert={trigger => beginSection(section.id, trigger)} changed={changedFields.includes(`section:${section.id}`)} onRename={title => apply(renameQuoteSection(quote, section.id, title))} onMove={delta => { apply(moveQuoteSection(quote, section.id, delta)); setSectionId(section.id); }} onDuplicate={() => { const id = `section-${randomUUID()}`; const next = duplicateQuoteSection(quote, section.id, id, quoteLineId); apply(renameQuoteSection(next, id, `${section.title} copie`)); setSectionId(id); setTimeout(() => document.getElementById(`section-${id}`)?.querySelector<HTMLElement>('.qp-section-rename-trigger')?.focus({ preventScroll: true }), 0); }} onRemove={() => removeSection(section.id, false)} onDelete={() => removeSection(section.id, true)} />
            {lines.map(renderLine)}
            <div className="qp-section-subtotal"><span>{incomplete ? 'Sous-total partiel' : 'Sous-total'}</span><strong>{formatMoney(subtotal)}</strong></div>
            {!readOnly && insertion === section.id && <AddSectionControl locale={locale} after={section.id} initiallyOpen onCancel={cancelSection} onAdd={title => addSection(section.id, title)} />}
          </section>;
        })}
        {!readOnly && quote.sections.length === 0 && <div className="qp-add-line"><Button variant="outline" onClick={() => addLine('')}><Plus data-icon="inline-start" />{t('Ajouter une ligne', 'Add a line')}</Button></div>}
        {!readOnly && <AddSectionControl key={insertion === 'end' ? 'open' : 'closed'} locale={locale} after={null} initiallyOpen={insertion === 'end'} onCancel={insertion === 'end' ? cancelSection : undefined} onAdd={title => addSection(null, title)} />}
        <div className="qp-totals" id="quote-totals">
          {!readOnly && changedFields.includes('discount') && <span className="qp-changed-label" lang={locale}><Check />{t('Remise modifiée', 'Discount changed')}</span>}
          <div><span>{sum.missing ? 'Sous-total partiel HT' : 'Sous-total HT'}</span><span>{formatMoney(sum.subtotal)}</span></div>
          {quote.discountMode !== 'none' && <div><span>Remise {quote.discountMode === 'percent' ? `${quote.discount} %` : 'CHF'}</span><span>{sum.missing || !sum.validDiscount ? '—' : `− ${formatMoney(sum.discount)}`}</span></div>}
          {!readOnly && <Button variant="ghost" size="sm" className="qp-detail-action" onClick={() => openModal('discount')}><Pencil data-icon="inline-start" />{quote.discountMode === 'none' ? t('Ajouter une remise', 'Add discount') : t('Modifier la remise', 'Edit discount')}</Button>}
          {warning('vatRegistered')}{warning('vatId')}{warning('discount')}
          {quote.vatRegistered && <div><span>TVA 8,1 %</span><span>{sum.total === null ? '—' : formatMoney(sum.vat)}</span></div>}
          <div className="qp-total"><strong>{sum.total === null ? 'Total à compléter' : 'Total CHF'}</strong><strong>{formatMoney(sum.total)}</strong></div>
          {calculation.errors.some(problem => problem.path === 'discount') && <p className="qp-missing">{t('La remise doit être comprise entre zéro et le sous-total.', 'Discount must be between zero and the subtotal.')}</p>}
        </div>
        <footer className="qp-terms"><h3>Conditions</h3>{readOnly ? <p>{quote.terms || 'Conditions à renseigner'}</p> : <button type="button" className="qp-edit-target qp-terms-target" onClick={() => openModal('terms')} aria-label={t('Modifier les conditions', 'Edit terms')}><span>{quote.terms || t('Ajouter des conditions', 'Add terms')}</span><EditAffordance locale={locale} /></button>}{quote.validUntil && <p>Offre valable jusqu’au {quote.validUntil}.</p>}{quote.vatRegistered && <p>{quote.vatId}</p>}</footer>
      </article>
    </div>
    <div className="qp-document-bottom"><span>{sum.total === null ? t('Chiffrage partiel', 'Partially priced') : t('Total du devis', 'Quote total')}</span><strong>CHF {formatMoney(sum.total ?? sum.subtotal)}</strong></div>
  </section>;


  return <div className="qp-app qp-variant-b" data-narrow-panel={narrowPanel} data-assistant-collapsed={assistantCollapsed} lang={locale}>
    <QuoteHeader locale={locale} onLanguage={onLanguage} onList={onList} quote={quote} onRecords={() => openModal('records')} />
    {error && <Alert variant="destructive" className="qp-request-error"><TriangleAlert /><AlertTitle>{t('Action non enregistrée', 'Action not saved')}</AlertTitle><AlertDescription>{error === 'reference_in_use' ? t('Cette référence appartient déjà à un autre devis. Modifiez-la dans la référence du devis.', 'Another Quote already uses this reference. Change it in the Quote reference.') : error.includes('conflict') || error.includes('stale') ? t('Ce devis a changé dans une autre fenêtre. Vos modifications restent visibles. Copiez-les avant de recharger.', 'This Quote changed in another window. Your edits remain visible. Copy them before reloading.') : t('Vos modifications restent visibles. Vérifiez les valeurs et votre connexion, puis réessayez.', 'Your edits remain visible. Check the values and your connection, then retry.')}</AlertDescription></Alert>}
    <main className="qp-workspace"><h1 className="sr-only">{t('Préparer un devis', 'Prepare a Quote')}</h1>
      <ToggleGroup className="qp-narrow-tabs" type="single" value={narrowPanel} onValueChange={value => { if (value === 'chat' || value === 'quote') setNarrowPanel(value); }} aria-label={t('Espace de travail', 'Workspace view')}><ToggleGroupItem value="chat" aria-controls="qp-assistant"><MessageSquare data-icon="inline-start" />{t('Conversation', 'Conversation')}</ToggleGroupItem><ToggleGroupItem value="quote" aria-controls="qp-quote-document"><FileText data-icon="inline-start" />{t('Devis', 'Quote')}</ToggleGroupItem></ToggleGroup>
      <div className="qp-layout qp-layout-b"><div id="qp-review-outline" className="qp-review-rail" hidden={!quote.sections.length} data-collapsed={!showOutline}>{outline}</div><div className="qp-review-main">{toolbar}<div className="qp-split">{quoteDocument}{chat}</div></div></div>
    </main>
    {editLine && !readOnly && <LineEditor focusField={focusField} line={editLine} lineNumber={quote.lines.some(line => line.id === editLine.id) ? quote.lines.findIndex(line => line.id === editLine.id) + 1 : undefined} sections={quote.sections} locale={locale} onClose={closeModal} onApply={line => {
      const previous = quote.lines.find(candidate => candidate.id === line.id);
      const next = { ...quote, lines: previous && previous.sectionId !== line.sectionId
        ? appendQuoteLineToSection(quote.lines, line, quote.sections)
        : quote.lines.some(candidate => candidate.id === line.id)
          ? quote.lines.map(candidate => candidate.id === line.id ? line : candidate)
          : appendQuoteLineToSection(quote.lines, line, quote.sections) };
      apply(next, [line.id]);
    }} />}
    {modal === 'business' && !readOnly && <BusinessQuoteEditor quote={quote} locale={locale} focusField={focusField} onClose={closeModal} onApply={q => apply(q)} onSettings={() => setModal('records')} />}
    {modal === 'customer' && !readOnly && <CustomerQuoteEditor quote={quote} locale={locale} focusField={focusField} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'site' && !readOnly && <SiteQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'discount' && !readOnly && <DiscountQuoteEditor quote={quote} locale={locale} focusField={focusField} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'terms' && !readOnly && <TermsQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'records' && <RecordsEditor quote={readOnly ? null : quote} locale={locale} onApplyCustomer={applyCustomer} onClose={closeModal} />}
    {modal === 'privacy' && <AssistantDisclosure locale={locale} processing={quoteAI} onClose={closeModal} />}
    {modal === 'publish' && <Dialog open onOpenChange={open => { if (!open) closeModal(); }}><DialogContent className="qp-modal" showCloseButton={false}><DialogHeader><DialogTitle>{t('Relire avant publication', 'Review before publication')}</DialogTitle><DialogDescription>{t('La publication fige le contenu. Elle n’envoie pas le devis.', 'Publication freezes the content. It does not send the Quote.')}</DialogDescription></DialogHeader>
      <div className="qp-publication-summary"><FileText /><h2>{quote.title}</h2><p>{quote.customerName || t('Destinataire manquant', 'Missing Customer')}</p><strong>CHF {formatMoney(sum.total)}</strong><p>{quote.reference} · {t('Révision', 'Revision')} {revisions.length + 1}</p></div>
      <ul className="qp-publication-checks"><li>{sum.total !== null ? <Check /> : <TriangleAlert />}{t('Toutes les lignes sont chiffrées', 'Every line is priced')}</li><li>{!missingAdmin ? <Check /> : <TriangleAlert />}{t('Coordonnées et informations requises', 'Contact details and required information')}</li><li>{save === 'saved' ? <Check /> : <TriangleAlert />}{t('Modifications enregistrées', 'Changes saved')}</li><li>{ai !== 'processing' ? <Check /> : <TriangleAlert />}{t('Aucune modification IA en attente', 'No AI change pending')}</li></ul>
      {blocked ? <Alert><TriangleAlert /><AlertTitle>{t('Publication indisponible', 'Publication unavailable')}</AlertTitle><AlertDescription>{t('Complétez les points signalés puis revenez à cette relecture.', 'Complete the flagged points, then return to this review.')}<ul>{[...calculation.errors, ...calculation.missing].map((problem, i) => <li key={i}>{problemLabel(problem, locale)}{<Button type="button" variant="link" size="sm" onClick={() => { closeModal(); setTimeout(() => revealField(problem.path), 0); }}>{t('Corriger', 'Fix')}</Button>}</li>)}</ul></AlertDescription></Alert> : <p>{t('Cette révision ne pourra être ni modifiée ni annulée. Une correction nécessitera une nouvelle révision.', 'This revision cannot be edited or undone. A correction requires a new revision.')}</p>}
      <div className="qp-modal-actions"><Button variant="outline" onClick={closeModal}>{t('Retour au devis', 'Back to Quote')}</Button><Button disabled={blocked} onClick={() => void publish()}><LockKeyhole data-icon="inline-start" />{t('Confirmer la publication', 'Confirm publication')}</Button></div>
    </DialogContent></Dialog>}
  </div>;
}
