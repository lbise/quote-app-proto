import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, CheckCheck, Copy, FileText, LockKeyhole, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
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
  const [modal, setModal] = useState<'business' | 'customer' | 'site' | 'discount' | 'terms' | 'publish' | 'records' | 'privacy' | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [narrowPanel, setNarrowPanel] = useState<'chat' | 'quote'>('chat');
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
  const missingLines = quote.lines.filter(l => amountFor(l) === null);
  const blocker = useBlocker(save !== 'saved');

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
  function openModal(name: typeof modal) { returnLineId.current = null; returnFocus.current = document.activeElement as HTMLElement; setModal(name); }
  function edit(line: QuoteLine) { returnLineId.current = line.id; returnFocus.current = document.activeElement as HTMLElement; setEditLine(clone(line)); }
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
    if (field === 'title') { setTitleDraft(quote.title); setEditingTitle(true); }
    else if (field === 'discount' || field === 'discountMode') openModal('discount');
    else if (field === 'siteAddress') openModal('site');
    else if (field.startsWith('customer')) openModal('customer');
    else if (field.startsWith('business') || field.startsWith('vat')) openModal('business');
    else if (field === 'terms') openModal('terms');
    else if (field === 'reference' || field === 'issueDate' || field === 'validUntil') setTimeout(() => metadataTrigger.current?.click(), 0);
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
  function addSection(afterId: string | null, title: string) {
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
      {!readOnly && <Button variant="ghost" disabled={!record.canUndo || save !== 'saved' || busy || ai === 'processing'} onClick={() => void mutate('undo')}><RotateCcw data-icon="inline-start" />{t('Annuler la dernière modification', 'Undo last change')}</Button>}
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

  const chat = <section className="qp-conversation" aria-label={t('Conversation avec l’assistant', 'Conversation with assistant')}>
    <header className="qp-panel-heading"><div className="qp-assistant-heading"><MessageSquare /><div><h2>{t('Assistant IA', 'AI assistant')}</h2></div></div><Button variant="ghost" size="icon-sm" onClick={() => openModal('privacy')} aria-label={t('Données envoyées à l’assistant', 'Assistant data and privacy')} title={t('Données envoyées à l’assistant', 'Assistant data and privacy')}><ShieldCheck /></Button></header>
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
            if (e.key !== 'Enter') return;
            if (e.ctrlKey || e.metaKey) {
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
          <div className="qp-composer-footer"><span>{t('Entrée pour envoyer · Ctrl + Entrée pour une nouvelle ligne', 'Enter to send · Ctrl + Enter for a new line')}</span><Button type="submit" disabled={!input.trim() || ai === 'processing'} aria-label={t('Envoyer le message', 'Send message')}><ArrowUp /></Button></div>
        </form>
      </>}
    </div>
  </section>;

  function renderLine(line: QuoteLine) {
    const index = quote.lines.findIndex(l => l.id === line.id), cents = amountFor(line);
    const canMoveUp = index > 0 && quote.lines[index - 1].sectionId === line.sectionId;
    const canMoveDown = index >= 0 && index < quote.lines.length - 1 && quote.lines[index + 1].sectionId === line.sectionId;
    return <div className={`qp-line ${changed.includes(line.id) ? 'qp-line-changed' : ''}`} id={`line-${line.id}`} key={line.id} data-testid="quote-line">
      <div className="qp-line-content" lang="fr"><span className="qp-line-number">{String(index + 1).padStart(2, '0')}</span><div className="qp-line-description">{line.description || <span className="qp-missing">Description à compléter</span>}{changed.includes(line.id) && <span className="qp-changed-label" lang={locale}><Check />{t('Modifié', 'Changed')}</span>}</div>
        <div className="qp-line-pricing">{line.mode === 'fixed' ? <span>Forfait</span> : <><span>{line.quantity || '—'} {line.unit || '—'}</span><span>× {line.unitPrice || '—'}</span></>}<strong>{formatMoney(cents)}</strong>{cents === null && <span className="qp-missing">À compléter</span>}{cents === 0 && <span>Sans frais</span>}</div>
      </div>
      {!readOnly && <div className="qp-line-actions" lang={locale}>
        <Button variant="ghost" size="sm" onClick={() => edit(line)} aria-label={`${t('Modifier la ligne', 'Edit line')} ${index + 1}`}><Pencil data-icon="inline-start" />{t('Modifier', 'Edit')}</Button>
        <Button variant="ghost" size="icon-sm" aria-label={`${t('Dupliquer la ligne', 'Duplicate line')} ${index + 1}`} onClick={() => { const next = clone(quote), copy = { ...line, id: quoteLineId() }; next.lines.splice(index + 1, 0, copy); apply(next, [copy.id]); }}><Copy /></Button>
        <Button variant="ghost" size="icon-sm" disabled={!canMoveUp} aria-label={`${t('Monter la ligne', 'Move up line')} ${index + 1}`} onClick={() => moveLine(line, -1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" disabled={!canMoveDown} aria-label={`${t('Descendre la ligne', 'Move down line')} ${index + 1}`} onClick={() => moveLine(line, 1)}><ArrowDown /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`${t('Supprimer la ligne', 'Delete line')} ${index + 1}`} onClick={() => deleteLine(line)}><Trash2 /></Button>
      </div>}
    </div>;
  }
  const quoteDocument = <section className="qp-document-pane" aria-label={t('Devis destiné au client', 'Customer-facing Quote')}>
    <div className="qp-document-tools"><span><FileText />{t('Le devis', 'The Quote')}<span className="qp-french-label">FR · CHF</span></span></div>
    {quote.sections.length > 0 && <div className="qp-jump qp-jump-narrow"><label htmlFor="section-jump">{t('Aller à', 'Jump to')}</label><select id="section-jump" value={activeSection} onChange={e => { setSectionId(e.target.value); document.getElementById(`section-${e.target.value}`)?.scrollIntoView({ block: 'start' }); }}>{quote.sections.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select></div>}
    <div key={recordId} className="qp-document-scroll" role="region" tabIndex={0} aria-label={t('Contenu du devis, défilant', 'Scrollable Quote content')}>
      {!readOnly && (sum.missing > 0 || missingAdmin) && <div className="qp-editor-guidance"><TriangleAlert /><div><strong>{sum.missing > 0 ? t(`${sum.missing} lignes à compléter`, `${sum.missing} lines need details`) : t('Coordonnées à compléter', 'Details need completing')}</strong><p>{sum.missing > 0 ? t('Le total définitif attend les valeurs manquantes.', 'The final total is withheld until values are complete.') : t('Les montants sont calculés, mais les coordonnées restent à renseigner.', 'Amounts are calculated, but contact details are still missing.')}</p></div><Button variant="ghost" size="sm" onClick={() => missingLines[0] ? reveal(missingLines[0].id) : revealField(([...calculation.errors, ...calculation.missing].find(problem => !problem.path.startsWith('lines'))?.path ?? 'businessName'))}>{t('Voir', 'View')}</Button></div>}
      {readOnly && <div className="qp-editor-guidance qp-published-note"><LockKeyhole /><p>{t('Révision figée. Publication sans envoi au destinataire.', 'Frozen revision. Publication did not send this Quote.')}</p></div>}
      <article className="qp-paper" lang="fr">
        <header className="qp-paper-header"><div className="qp-business-name">{quote.businessName || 'Entreprise à renseigner'}</div>{readOnly ? <div className="qp-paper-meta"><span>Devis {quote.reference}</span><span>{quote.issueDate}</span></div> : <QuoteMetadataPopover quote={quote} locale={locale} lockedReference={revisions.length > 0} onApply={q => apply(q)}><button ref={metadataTrigger} type="button" className="qp-paper-meta qp-edit-target" aria-label={t('Modifier la référence et les dates', 'Edit reference and dates')} title={t('Modifier la référence et les dates', 'Edit reference and dates')}><span>Devis {quote.reference || '…'}</span><span>{quote.issueDate || t('Date à renseigner', 'Set issue date')}</span><Pencil aria-hidden="true" /></button></QuoteMetadataPopover>}</header>
        <div className="qp-document-title" id="quote-title">{editingTitle && !readOnly ? <form className="qp-inline-title" onSubmit={e => { e.preventDefault(); apply({ ...quote, title: titleDraft }); setEditingTitle(false); }}><label htmlFor="quote-title-input" className="sr-only">{t('Objet du devis', 'Quote title')}</label><input id="quote-title-input" autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingTitle(false); }} /><Button type="submit" size="sm">{t('Enregistrer', 'Save')}</Button><Button type="button" variant="ghost" size="sm" onClick={() => setEditingTitle(false)}>{t('Annuler', 'Cancel')}</Button></form> : <h2 aria-label={!readOnly ? quote.title || t('Nouveau devis', 'New Quote') : undefined}>{readOnly ? quote.title || 'Nouveau devis' : <button type="button" className="qp-edit-target" onClick={() => { setTitleDraft(quote.title); setEditingTitle(true); }} aria-label={t('Modifier l’objet du devis', 'Edit Quote title')}>{quote.title || t('Ajouter un objet', 'Add a title')}<Pencil aria-hidden="true" /></button>}</h2>}{!readOnly && changedFields.includes('title') && <span className="qp-changed-label" lang={locale}><Check />{t('Objet modifié', 'Title changed')}</span>}{readOnly ? <p>{quote.siteAddress}</p> : <button type="button" className="qp-edit-target qp-site-target" onClick={() => openModal('site')} aria-label={t('Modifier l’adresse du chantier', 'Edit site address')}>{quote.siteAddress || t('Ajouter l’adresse du chantier', 'Add site address')}<Pencil aria-hidden="true" /></button>}</div>
        <div className="qp-addresses"><div><span>Proposé par</span>{readOnly ? <><strong>{quote.businessName}</strong><p>{quote.businessAddress}</p><p>{quote.businessContact}</p></> : <button type="button" className="qp-edit-target qp-address-target" onClick={() => openModal('business')} aria-label={t('Modifier les coordonnées de l’entreprise', 'Edit business details')}><strong>{quote.businessName || 'Entreprise à renseigner'}</strong><p>{quote.businessAddress}</p><p>{quote.businessContact}</p><Pencil aria-hidden="true" /></button>}</div><div><span>À l’attention de</span>{readOnly ? <><strong>{quote.customerName || 'Destinataire à renseigner'}</strong><p>{quote.customerAddress || 'Adresse à renseigner'}</p><p>{quote.customerContact}</p></> : <button type="button" className="qp-edit-target qp-address-target" onClick={() => openModal('customer')} aria-label={t('Choisir ou modifier le client', 'Choose or edit Customer')}><strong>{quote.customerName || t('Choisir un client', 'Choose a Customer')}</strong><p>{quote.customerAddress || 'Adresse à renseigner'}</p><p>{quote.customerContact}</p><Pencil aria-hidden="true" /></button>}</div></div>
        {!quote.lines.length && <div className="qp-empty-document"><FileText /><h2>Les travaux apparaîtront ici.</h2><p>Commencez par une description dans la conversation, ou ajoutez une ligne manuellement.</p></div>}
        {quote.lines.filter(l => !l.sectionId).map(renderLine)}
        {!readOnly && quote.sections.length > 0 && <div className="qp-section-add-line"><Button variant="ghost" size="sm" onClick={() => addLine('')}><Plus data-icon="inline-start" />{t('Ajouter une ligne sans section', 'Add ungrouped line')}</Button></div>}
        {quote.sections.map((section, sectionIndex) => {
          const lines = quote.lines.filter(l => l.sectionId === section.id);
          const sectionCalculation = calculation.sections.find(result => result.id === section.id);
          const incomplete = sectionCalculation?.incomplete ?? true;
          const subtotal = sectionCalculation?.subtotal ?? 0;
          return <section className="qp-quote-section" id={`section-${section.id}`} key={section.id}>
            <SectionHeading title={section.title} locale={locale} readOnly={readOnly} index={sectionIndex} count={quote.sections.length} lineCount={lines.length} changed={changedFields.includes(`section:${section.id}`)} onRename={title => apply(renameQuoteSection(quote, section.id, title))} onMove={delta => { apply(moveQuoteSection(quote, section.id, delta)); setSectionId(section.id); }} onDuplicate={() => { const id = `section-${randomUUID()}`; const next = duplicateQuoteSection(quote, section.id, id, quoteLineId); apply(renameQuoteSection(next, id, `${section.title} copie`)); setSectionId(id); setTimeout(() => document.getElementById(`section-${id}`)?.querySelector<HTMLElement>('.qp-section-rename-trigger')?.focus({ preventScroll: true }), 0); }} onRemove={() => removeSection(section.id, false)} onDelete={() => removeSection(section.id, true)} />
            {lines.map(renderLine)}
            <div className="qp-section-subtotal"><span>{incomplete ? 'Sous-total partiel' : 'Sous-total'}</span><strong>{formatMoney(subtotal)}</strong></div>
            {!readOnly && <div className="qp-section-add-line"><Button variant="ghost" size="sm" onClick={() => addLine(section.id)}><Plus data-icon="inline-start" />{t(`Ajouter une ligne à ${section.title}`, `Add line to ${section.title}`)}</Button></div>}
            {!readOnly && <AddSectionControl locale={locale} after={sectionIndex < quote.sections.length - 1 ? section.id : null} afterTitle={section.title} atEnd={sectionIndex === quote.sections.length - 1} onAdd={title => addSection(sectionIndex < quote.sections.length - 1 ? section.id : null, title)} />}
          </section>;
        })}
        {!readOnly && quote.sections.length === 0 && <div className="qp-add-line"><Button variant="outline" onClick={() => addLine('')}><Plus data-icon="inline-start" />{t('Ajouter une ligne', 'Add a line')}</Button></div>}
        {!readOnly && quote.sections.length === 0 && <AddSectionControl locale={locale} after={null} onAdd={title => addSection(null, title)} />}
        <div className="qp-totals" id="quote-totals">
          {!readOnly && changedFields.includes('discount') && <span className="qp-changed-label" lang={locale}><Check />{t('Remise modifiée', 'Discount changed')}</span>}
          <div><span>{sum.missing ? 'Sous-total partiel HT' : 'Sous-total HT'}</span><span>{formatMoney(sum.subtotal)}</span></div>
          {quote.discountMode !== 'none' && <div><span>Remise {quote.discountMode === 'percent' ? `${quote.discount} %` : 'CHF'}</span><span>{sum.missing || !sum.validDiscount ? '—' : `− ${formatMoney(sum.discount)}`}</span></div>}
          {!readOnly && <Button variant="ghost" size="sm" className="qp-detail-action" onClick={() => openModal('discount')}><Pencil data-icon="inline-start" />{quote.discountMode === 'none' ? t('Ajouter une remise', 'Add discount') : t('Modifier la remise', 'Edit discount')}</Button>}
          {!readOnly && quote.vatRegistered === null && <Button variant="ghost" size="sm" className="qp-detail-action" onClick={() => openModal('business')}>{t('Préciser la TVA', 'Confirm VAT status')}</Button>}
          {quote.vatRegistered && <div><span>TVA 8,1 %</span><span>{sum.total === null ? '—' : formatMoney(sum.vat)}</span></div>}
          <div className="qp-total"><strong>{sum.total === null ? 'Total à compléter' : 'Total CHF'}</strong><strong>{formatMoney(sum.total)}</strong></div>
          {!sum.validDiscount && <p className="qp-missing">La remise doit être comprise entre zéro et le sous-total.</p>}
        </div>
        <footer className="qp-terms"><h3>Conditions</h3>{readOnly ? <p>{quote.terms || 'Conditions à renseigner'}</p> : <button type="button" className="qp-edit-target qp-terms-target" onClick={() => openModal('terms')} aria-label={t('Modifier les conditions', 'Edit terms')}>{quote.terms || t('Ajouter des conditions', 'Add terms')}<Pencil aria-hidden="true" /></button>}{quote.validUntil && <p>Offre valable jusqu’au {quote.validUntil}.</p>}{quote.vatRegistered && <p>{quote.vatId}</p>}</footer>
      </article>
    </div>
    <div className="qp-document-bottom"><span>{sum.total === null ? t('Chiffrage partiel', 'Partially priced') : t('Total du devis', 'Quote total')}</span><strong>CHF {formatMoney(sum.total ?? sum.subtotal)}</strong></div>
  </section>;


  return <div className="qp-app qp-variant-b" data-narrow-panel={narrowPanel} lang={locale}>
    <QuoteHeader locale={locale} onLanguage={onLanguage} onList={onList} quote={quote} onRecords={() => openModal('records')} />
    {error && <Alert variant="destructive" className="qp-request-error"><TriangleAlert /><AlertTitle>{t('Action non enregistrée', 'Action not saved')}</AlertTitle><AlertDescription>{error === 'reference_in_use' ? t('Cette référence appartient déjà à un autre devis. Modifiez-la dans la référence du devis.', 'Another Quote already uses this reference. Change it in the Quote reference.') : error.includes('conflict') || error.includes('stale') ? t('Ce devis a changé dans une autre fenêtre. Vos modifications restent visibles. Copiez-les avant de recharger.', 'This Quote changed in another window. Your edits remain visible. Copy them before reloading.') : t('Vos modifications restent visibles. Vérifiez les valeurs et votre connexion, puis réessayez.', 'Your edits remain visible. Check the values and your connection, then retry.')}</AlertDescription></Alert>}
    <main className="qp-workspace"><h1 className="sr-only">{t('Préparer un devis', 'Prepare a Quote')}</h1>
      <div className="qp-narrow-tabs"><Button variant={narrowPanel === 'chat' ? 'secondary' : 'ghost'} onClick={() => setNarrowPanel('chat')} aria-pressed={narrowPanel === 'chat'}><MessageSquare data-icon="inline-start" />{t('Conversation', 'Conversation')}</Button><Button variant={narrowPanel === 'quote' ? 'secondary' : 'ghost'} onClick={() => setNarrowPanel('quote')} aria-pressed={narrowPanel === 'quote'}><FileText data-icon="inline-start" />{t('Devis', 'Quote')}</Button></div>
      <div className="qp-layout qp-layout-b"><div id="qp-review-outline" className="qp-review-rail" hidden={!quote.sections.length} data-collapsed={!showOutline}>{outline}</div><div className="qp-review-main">{toolbar}<div className="qp-split">{quoteDocument}{chat}</div></div></div>
    </main>
    {editLine && <LineEditor line={editLine} sections={quote.sections} locale={locale} onClose={closeModal} onApply={line => {
      const previous = quote.lines.find(candidate => candidate.id === line.id);
      const next = { ...quote, lines: previous && previous.sectionId !== line.sectionId
        ? appendQuoteLineToSection(quote.lines, line, quote.sections)
        : quote.lines.some(candidate => candidate.id === line.id)
          ? quote.lines.map(candidate => candidate.id === line.id ? line : candidate)
          : appendQuoteLineToSection(quote.lines, line, quote.sections) };
      apply(next, [line.id]);
    }} />}
    {modal === 'business' && !readOnly && <BusinessQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} onSettings={() => setModal('records')} />}
    {modal === 'customer' && !readOnly && <CustomerQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'site' && !readOnly && <SiteQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'discount' && !readOnly && <DiscountQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'terms' && !readOnly && <TermsQuoteEditor quote={quote} locale={locale} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'records' && <RecordsEditor quote={readOnly ? null : quote} locale={locale} onApplyCustomer={applyCustomer} onClose={closeModal} />}
    {modal === 'privacy' && <AssistantDisclosure locale={locale} processing={quoteAI} onClose={closeModal} />}
    {modal === 'publish' && <Dialog open onOpenChange={open => { if (!open) closeModal(); }}><DialogContent className="qp-modal" showCloseButton={false}><DialogHeader><DialogTitle>{t('Relire avant publication', 'Review before publication')}</DialogTitle><DialogDescription>{t('La publication fige le contenu. Elle n’envoie pas le devis.', 'Publication freezes the content. It does not send the Quote.')}</DialogDescription></DialogHeader>
      <div className="qp-publication-summary"><FileText /><h2>{quote.title}</h2><p>{quote.customerName || t('Destinataire manquant', 'Missing Customer')}</p><strong>CHF {formatMoney(sum.total)}</strong><p>{quote.reference} · {t('Révision', 'Revision')} {revisions.length + 1}</p></div>
      <ul className="qp-publication-checks"><li>{sum.total !== null ? <Check /> : <TriangleAlert />}{t('Toutes les lignes sont chiffrées', 'Every line is priced')}</li><li>{!missingAdmin ? <Check /> : <TriangleAlert />}{t('Coordonnées et informations requises', 'Contact details and required information')}</li><li>{save === 'saved' ? <Check /> : <TriangleAlert />}{t('Modifications enregistrées', 'Changes saved')}</li><li>{ai !== 'processing' ? <Check /> : <TriangleAlert />}{t('Aucune modification IA en attente', 'No AI change pending')}</li></ul>
      {blocked ? <Alert><TriangleAlert /><AlertTitle>{t('Publication indisponible', 'Publication unavailable')}</AlertTitle><AlertDescription>{t('Complétez les points signalés puis revenez à cette relecture.', 'Complete the flagged points, then return to this review.')}<ul>{[...calculation.errors, ...calculation.missing].map((problem, i) => <li key={i}>{problemLabel(problem, locale)}{!problem.path.startsWith('lines') && !problem.path.startsWith('sections') && <Button type="button" variant="link" size="sm" onClick={() => { closeModal(); setTimeout(() => revealField(problem.path), 0); }}>{t('Corriger', 'Fix')}</Button>}</li>)}</ul></AlertDescription></Alert> : <p>{t('Cette révision ne pourra être ni modifiée ni annulée. Une correction nécessitera une nouvelle révision.', 'This revision cannot be edited or undone. A correction requires a new revision.')}</p>}
      <div className="qp-modal-actions"><Button variant="outline" onClick={closeModal}>{t('Retour au devis', 'Back to Quote')}</Button><Button disabled={blocked} onClick={() => void publish()}><LockKeyhole data-icon="inline-start" />{t('Confirmer la publication', 'Confirm publication')}</Button></div>
    </DialogContent></Dialog>}
  </div>;
}
