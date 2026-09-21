import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCheck, Copy, FileText, List, LockKeyhole, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Settings2, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { Message, MessageContent, MessageHeader } from '../ui/message';
import { Bubble, BubbleContent } from '../ui/bubble';
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from '../ui/message-scroller';
import { appendQuoteLineToSection, calculateQuote, money, type QuoteLine } from '../../lib/quote';
import { quoteLineId } from '../../lib/random-id';
import { LineEditor, ManualEditor } from './manual-editor';
import { RecordsEditor } from './records-editor';
import { SectionsEditor } from './sections-editor';
import { useQuote, type QuoteRecord } from './use-quote';
import { QuoteHeader } from './quote-header';
import { AssistantDisclosure } from './assistant-disclosure';
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
  const [modal, setModal] = useState<'details' | 'publish' | 'sections' | 'records' | 'privacy' | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [narrowPanel, setNarrowPanel] = useState<'chat' | 'quote'>('chat');
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnLineId = useRef<string | null>(null);
  const quote = readRevision === null ? state.quote : record.revisions[readRevision].quote;
  const revisions = record.revisions, messages = record.messages, recordId = record.id;
  const readOnly = readRevision !== null;
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const outcomeLabel = (outcome?: string) => outcome === 'committed' || outcome === 'committed_with_failed_calls' ? t('enregistré', 'committed') : outcome === 'unchanged' || outcome === 'unchanged_with_failed_calls' ? t('inchangé', 'unchanged') : outcome === 'discarded' ? t('abandonné', 'discarded') : outcome ?? '—';
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
      else if (document.getElementById('quote-section-opener')) document.getElementById('quote-section-opener')?.focus({ preventScroll: true });
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
    const id = field === 'discount' ? 'quote-totals' : 'quote-title';
    if (field === 'title' || field === 'discount' || field === 'issueDate' || field === 'validUntil' || field === 'siteAddress') {
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center' }), 0);
      return;
    }
    openModal('details');
  }
  function moveLine(line: QuoteLine, delta: number) {
    const next = clone(quote), i = next.lines.findIndex(l => l.id === line.id), j = i + delta;
    if (i < 0 || j < 0 || j >= next.lines.length || next.lines[j].sectionId !== line.sectionId) return;
    [next.lines[i], next.lines[j]] = [next.lines[j], next.lines[i]];
    apply(next, [line.id]);
    setTimeout(() => document.getElementById(`line-${line.id}`)?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
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
    {!readOnly && <Button variant="ghost" onClick={() => openModal('sections')}><Settings2 data-icon="inline-start" />{t('Organiser', 'Organise')}</Button>}
  </>;
  const outline = <nav className="qp-outline" aria-label={t('Sections du devis', 'Quote sections')}>
    <div className="qp-outline-heading"><div className="qp-outline-title-row"><span>Sections</span>{<Button variant="ghost" size="icon-sm" aria-label={showOutline ? t('Réduire les sections', 'Collapse sections') : t('Développer les sections', 'Expand sections')} title={showOutline ? t('Réduire les sections', 'Collapse sections') : t('Développer les sections', 'Expand sections')} aria-controls="qp-section-links" aria-expanded={showOutline} onClick={() => setOutlineCollapsed(x => !x)}>{showOutline ? <PanelLeftClose /> : <PanelLeftOpen />}</Button>}</div></div>
    {<div id="qp-section-links" className="qp-outline qp-outline-links" hidden={!showOutline}>{outlineLinks}</div>}
  </nav>;

  const chat = <section className="qp-conversation" aria-label={t('Conversation avec l’assistant', 'Conversation with assistant')}>
    <header className="qp-panel-heading"><div className="qp-assistant-heading"><MessageSquare /><div><h2>{t('Préparons votre devis', 'Prepare your Quote')}</h2></div></div><Button variant="ghost" size="icon-sm" onClick={() => openModal('privacy')} aria-label={t('Données envoyées à l’assistant', 'Assistant data and privacy')} title={t('Données envoyées à l’assistant', 'Assistant data and privacy')}><ShieldCheck /></Button></header>
    <MessageScrollerProvider key={recordId} autoScroll defaultScrollPosition="last-anchor" scrollPreviousItemPeek={0}><MessageScroller className="qp-chat-scroller">
      <MessageScrollerViewport><MessageScrollerContent className="qp-chat-content">
        
        {messages.map((message, i) => <MessageScrollerItem key={i} messageId={`message-${i}`} scrollAnchor={message.role === 'artisan'}>
          <Message align={message.role === 'artisan' ? 'end' : 'start'} className={message.role === 'note' ? 'qp-note-message' : ''}><MessageContent>
            <MessageHeader>{message.role === 'artisan' ? t('Vous', 'You') : message.role === 'note' ? t('Historique', 'History') : 'Easy Quote'}</MessageHeader>
            <Bubble variant={message.role === 'artisan' ? 'secondary' : 'ghost'}><BubbleContent>{message[locale]}</BubbleContent></Bubble>
            {!!message.changed?.length && <div className="qp-change-links"><span><Check />{message.changed.length} {t('lignes modifiées', 'lines changed')}</span>{message.changed?.some(id => quote.lines.some(line => line.id === id)) && <Button variant="link" size="sm" onClick={() => reveal(message.changed!.find(id => quote.lines.some(line => line.id === id))!, true)}>{t('Voir dans le devis', 'View in Quote')}<ArrowRight data-icon="inline-end" /></Button>}</div>}
            {!!message.changedFields?.length && <div className="qp-change-links"><span><Check />{t('Détails du devis modifiés', 'Quote details changed')}</span><Button variant="link" size="sm" onClick={() => revealField(message.changedFields![0])}>{t('Voir les détails modifiés', 'View changed details')}<ArrowRight data-icon="inline-end" /></Button></div>}
          </MessageContent></Message>
        </MessageScrollerItem>)}
        {toolDebug && <MessageScrollerItem><details className="qp-assistant-debug qp-assistant-tool-debug"><summary>{t('Détails du tour (débogage)', 'Turn details (debug)')}</summary><p className="qp-assistant-debug-warning">{t('Données de débogage sensibles : ces requêtes et appels peuvent contenir le brouillon complet et des coordonnées. Elles sont temporaires et ne sont pas conservées dans les journaux.', 'Sensitive debug data: these requests and tool calls may contain the complete Working Draft and Customer details. They are temporary and are not stored in application logs.')}</p>{toolDebug.failedCalls !== undefined && <p>{t(`Appels d’outil en échec : ${toolDebug.failedCalls}/${toolDebug.failureLimit ?? 3}`, `Failed calls: ${toolDebug.failedCalls}/${toolDebug.failureLimit ?? 3}`)}</p>}{toolDebug.outcome && <p>{t('Résultat du tour', 'Turn outcome')}: {outcomeLabel(toolDebug.outcome)}</p>}{toolDebug.attempts?.map((attempt, index) => <div key={`${attempt.name}-${index}`}><strong>{t(`Appel d’outil : ${attempt.name}. Résultat : ${attempt.outcome}`, `Tool call: ${attempt.name}. Outcome: ${attempt.outcome}`)}</strong><pre>{JSON.stringify(attempt, null, 2)}</pre></div>)}{(toolDebug.llmRequests ?? (toolDebug.llmRequest ? [toolDebug.llmRequest] : [])).map((request, index) => <div key={`request-${index}`}><strong>{t(`Requête application ${index + 1}`, `Application request ${index + 1}`)}</strong><pre>{JSON.stringify(request, null, 2)}</pre></div>)}{toolDebug.requestId && <p>{t('Requête', 'Request')}: <code>{toolDebug.requestId}</code></p>}</details></MessageScrollerItem>}
        {ai === 'processing' && <MessageScrollerItem><p className="qp-processing" role="status"><span className="qp-spinner" />{t('Je prépare la modification. Vous pouvez continuer à éditer.', 'Preparing the change. You can keep editing.')}</p></MessageScrollerItem>}
        {(ai === 'error' || ai === 'stale') && <MessageScrollerItem><Alert variant="destructive"><TriangleAlert /><AlertTitle>{ai === 'stale' ? t('Votre correction est conservée', 'Your edit is preserved') : t('L’assistant n’a pas répondu', 'The assistant did not respond')}</AlertTitle><AlertDescription><p>{ai === 'stale' ? t('La réponse est devenue obsolète pendant votre modification. Elle n’a pas été appliquée.', 'The response became stale while you edited. It was not applied.') : debug?.code === 'destructive_scope_rejected' ? t('Aucune modification de ce tour n’a été enregistrée. Supprimez les travaux avec les contrôles manuels.', 'Nothing from this turn was saved. Delete the work manually instead.') : debug?.outcome === 'failed_call_limit_reached' ? t('L’assistant s’est arrêté après trois appels d’outil en échec. Aucune modification de cette demande n’a été enregistrée.', 'The assistant stopped after three failed tool calls. No changes from this request were saved.') : debug?.outcome === 'draft_context_too_large' ? t('Ce brouillon complet dépasse la limite de taille de l’assistant. Aucune donnée n’a été transmise au fournisseur.', 'This complete Working Draft exceeds the assistant’s size limit. Nothing was sent to the provider.') : debug?.outcome === 'later_budget_exhausted' ? t('L’assistant a atteint une limite de traitement. Aucune modification de ce tour n’a été enregistrée.', 'The assistant reached a processing limit. Nothing from this turn was saved.') : t('Le devis n’a pas changé. Réessayez ou continuez manuellement.', 'The Quote is unchanged. Retry or continue manually.')}</p>{ai === 'error' && debug && <details className="qp-assistant-debug"><summary>{t('Détails développeur', 'Developer details')}</summary><p className="qp-assistant-debug-warning">{t('Données de débogage sensibles : ces requêtes et appels d’outils peuvent contenir le brouillon complet, les coordonnées et la conversation. Elles sont temporaires et ne sont pas conservées dans les journaux. Les identifiants secrets sont exclus.', 'Sensitive debug data: these requests and tool calls may contain the complete Working Draft, Customer and business details, and conversation. They are temporary and are not stored in application logs. Credentials are excluded.')}</p><dl><dt>{t('Phase', 'Phase')}</dt><dd><code>{debug.phase}</code></dd><dt>{t('Code', 'Code')}</dt><dd><code>{debug.code}</code></dd>{debug.failedCalls !== undefined && <><dt>{t('Compteur', 'Counter')}</dt><dd>{t(`Appels d’outil en échec : ${debug.failedCalls}/${debug.failureLimit ?? 3}`, `Failed calls: ${debug.failedCalls}/${debug.failureLimit ?? 3}`)}</dd></>}{debug.outcome && <><dt>{t('Résultat du tour', 'Turn outcome')}</dt><dd>{outcomeLabel(debug.outcome)}</dd></>}{debug.tool && <><dt>{t('Outil', 'Tool')}</dt><dd><code>{debug.tool}</code></dd></>}{debug.attempts?.map((attempt, index) => <div key={`${attempt.name}-${index}`}><dt>{t('Appel', 'Attempt')}</dt><dd>{t(`Appel d’outil : ${attempt.name}. Résultat : ${attempt.outcome}`, `Tool call: ${attempt.name}. Outcome: ${attempt.outcome}`)}<pre>{JSON.stringify(attempt, null, 2)}</pre></dd></div>)}{debug.toolCall && <><dt>{t('Appel complet', 'Full tool call')}</dt><dd><pre>{JSON.stringify(debug.toolCall, null, 2)}</pre></dd></>}{(debug.llmRequests ?? (debug.llmRequest ? [debug.llmRequest] : [])).map((request, index) => <div key={`request-${index}`}><dt>{t(`Requête LLM ${index + 1}`, `LLM request ${index + 1}`)}</dt><dd><pre>{JSON.stringify(request, null, 2)}</pre></dd></div>)}{!debug.llmRequest && !debug.llmRequests?.length && <><dt>{t('Envoi', 'Sent')}</dt><dd>{t('Non transmis au fournisseur', 'Not sent to the provider')}</dd></>}{debug.applicationContext !== undefined && <><dt>{t('Entrée application', 'Application input')}</dt><dd><pre>{JSON.stringify(debug.applicationContext, null, 2)}</pre></dd></>}{debug.requestId && <><dt>{t('Requête', 'Request')}</dt><dd><code>{debug.requestId}</code></dd></>}</dl></details>}<Button variant="outline" onClick={() => { void sendMessage(lastRequest.current?.text ?? '', true); }}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert></MessageScrollerItem>}
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
    <div className="qp-document-tools"><span><FileText />{t('Le devis', 'The Quote')}<span className="qp-french-label">FR · CHF</span></span><div>{!readOnly && <Button variant="ghost" size="sm" onClick={() => openModal('details')}><Settings2 data-icon="inline-start" />{t('Coordonnées et conditions', 'Details & terms')}</Button>}{!readOnly && <Button id="quote-section-opener" variant="ghost" size="icon-sm" aria-label={quote.sections.length ? t('Organiser les sections', 'Organise sections') : t('Ajouter une section', 'Add a section')} onClick={() => openModal('sections')}><List /></Button>}</div></div>
    {quote.sections.length > 0 && <div className="qp-jump qp-jump-narrow"><label htmlFor="section-jump">{t('Aller à', 'Jump to')}</label><select id="section-jump" value={activeSection} onChange={e => { setSectionId(e.target.value); document.getElementById(`section-${e.target.value}`)?.scrollIntoView({ block: 'start' }); }}>{quote.sections.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select><Button variant="ghost" size="icon-sm" aria-label={t('Organiser les sections', 'Organise sections')} onClick={() => openModal('sections')} disabled={readOnly}><List /></Button></div>}
    <div key={recordId} className="qp-document-scroll" role="region" tabIndex={0} aria-label={t('Contenu du devis, défilant', 'Scrollable Quote content')}>
      {!readOnly && (sum.missing > 0 || missingAdmin) && <div className="qp-editor-guidance"><TriangleAlert /><div><strong>{sum.missing > 0 ? t(`${sum.missing} lignes à compléter`, `${sum.missing} lines need details`) : t('Coordonnées à compléter', 'Details need completing')}</strong><p>{sum.missing > 0 ? t('Le total définitif attend les valeurs manquantes.', 'The final total is withheld until values are complete.') : t('Les montants sont calculés, mais les coordonnées restent à renseigner.', 'Amounts are calculated, but contact details are still missing.')}</p></div><Button variant="ghost" size="sm" onClick={() => missingLines[0] ? reveal(missingLines[0].id) : openModal('details')}>{t('Voir', 'View')}</Button></div>}
      {readOnly && <div className="qp-editor-guidance qp-published-note"><LockKeyhole /><p>{t('Révision figée. Publication sans envoi au destinataire.', 'Frozen revision. Publication did not send this Quote.')}</p></div>}
      <article className="qp-paper" lang="fr">
        <header className="qp-paper-header"><div className="qp-business-name">{quote.businessName || 'Entreprise à renseigner'}</div><div className="qp-paper-meta"><span>Devis {quote.reference}</span><span>{quote.issueDate}</span></div></header>
        <div className="qp-document-title" id="quote-title"><h2>{quote.title || 'Nouveau devis'}</h2>{!readOnly && changedFields.includes('title') && <span className="qp-changed-label" lang={locale}><Check />{t('Objet modifié', 'Title changed')}</span>}<p>{quote.siteAddress}</p></div>
        {<div className="qp-addresses"><div><span>Proposé par</span><strong>{quote.businessName}</strong><p>{quote.businessAddress}</p><p>{quote.businessContact}</p></div><div><span>À l’attention de</span><strong>{quote.customerName || 'Destinataire à renseigner'}</strong><p>{quote.customerAddress || 'Adresse à renseigner'}</p><p>{quote.customerContact}</p></div></div>}
        {!quote.lines.length && <div className="qp-empty-document"><FileText /><h2>Les travaux apparaîtront ici.</h2><p>Commencez par une description dans la conversation, ou ajoutez une ligne manuellement.</p></div>}
        {quote.lines.filter(l => !l.sectionId).map(renderLine)}
        {quote.sections.map(section => {
          const lines = quote.lines.filter(l => l.sectionId === section.id);
          const sectionCalculation = calculation.sections.find(result => result.id === section.id);
          const incomplete = sectionCalculation?.incomplete ?? true;
          const subtotal = sectionCalculation?.subtotal ?? 0;
          return <section className="qp-quote-section" id={`section-${section.id}`} key={section.id}>
            <div className="qp-section-title"><h3>{section.title}{!readOnly && changedFields.includes(`section:${section.id}`) && <span className="qp-changed-label" lang={locale}><Check />{t('Section modifiée', 'Section changed')}</span>}</h3><span>CHF</span></div>
            {lines.map(renderLine)}
            <div className="qp-section-subtotal"><span>{incomplete ? 'Sous-total partiel' : 'Sous-total'}</span><strong>{formatMoney(subtotal)}</strong></div>
          </section>;
        })}
        {!readOnly && <div className="qp-add-line"><Button variant="outline" onClick={() => edit({ id: quoteLineId(), sectionId: activeSection, description: '', mode: 'quantity', quantity: '', unit: 'm²', unitPrice: '', amount: '' })}><Plus data-icon="inline-start" />{t('Ajouter une ligne', 'Add a line')}</Button></div>}
        <div className="qp-totals" id="quote-totals">
          {!readOnly && changedFields.includes('discount') && <span className="qp-changed-label" lang={locale}><Check />{t('Remise modifiée', 'Discount changed')}</span>}
          <div><span>{sum.missing ? 'Sous-total partiel HT' : 'Sous-total HT'}</span><span>{formatMoney(sum.subtotal)}</span></div>
          {quote.discountMode !== 'none' && <div><span>Remise {quote.discountMode === 'percent' ? `${quote.discount} %` : 'CHF'}</span><span>{sum.missing || !sum.validDiscount ? '—' : `− ${formatMoney(sum.discount)}`}</span></div>}
          {quote.vatRegistered && <div><span>TVA 8,1 %</span><span>{sum.total === null ? '—' : formatMoney(sum.vat)}</span></div>}
          <div className="qp-total"><strong>{sum.total === null ? 'Total à compléter' : 'Total CHF'}</strong><strong>{formatMoney(sum.total)}</strong></div>
          {!sum.validDiscount && <p className="qp-missing">La remise doit être comprise entre zéro et le sous-total.</p>}
        </div>
        <footer className="qp-terms"><h3>Conditions</h3><p>{quote.terms || 'Conditions à renseigner'}</p>{quote.validUntil && <p>Offre valable jusqu’au {quote.validUntil}.</p>}{quote.vatRegistered && <p>{quote.vatId}</p>}</footer>
      </article>
      <p className="qp-document-caption">{t('Contenu commercial en français, quelle que soit la langue de l’interface.', 'Commercial content stays in French, independently of the interface language.')}</p>
    </div>
    <div className="qp-document-bottom"><span>{sum.total === null ? t('Chiffrage partiel', 'Partially priced') : t('Total du devis', 'Quote total')}</span><strong>CHF {formatMoney(sum.total ?? sum.subtotal)}</strong></div>
  </section>;


  return <div className="qp-app qp-variant-b" data-narrow-panel={narrowPanel} lang={locale}>
    <QuoteHeader locale={locale} onLanguage={onLanguage} onList={onList} quote={quote} onRecords={() => openModal('records')} />
    {error && <Alert variant="destructive" className="qp-request-error"><TriangleAlert /><AlertTitle>{t('Action non enregistrée', 'Action not saved')}</AlertTitle><AlertDescription>{error === 'reference_in_use' ? t('Cette référence appartient déjà à un autre devis. Modifiez-la dans les coordonnées du devis.', 'Another Quote already uses this reference. Change it in Details & terms.') : error.includes('conflict') || error.includes('stale') ? t('Ce devis a changé dans une autre fenêtre. Vos modifications restent visibles. Copiez-les avant de recharger.', 'This Quote changed in another window. Your edits remain visible. Copy them before reloading.') : t('Vos modifications restent visibles. Vérifiez les valeurs et votre connexion, puis réessayez.', 'Your edits remain visible. Check the values and your connection, then retry.')}</AlertDescription></Alert>}
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
    {modal === 'details' && <ManualEditor quote={quote} locale={locale} lockedReference={revisions.length > 0} onClose={closeModal} onApply={q => apply(q)} />}
    {modal === 'sections' && !readOnly && <SectionsEditor quote={quote} locale={locale} onApply={q => apply(q)} onClose={closeModal} />}
    {modal === 'records' && <RecordsEditor quote={readOnly ? null : quote} locale={locale} onApplyCustomer={applyCustomer} onClose={closeModal} />}
    {modal === 'privacy' && <AssistantDisclosure locale={locale} processing={quoteAI} onClose={closeModal} />}
    {modal === 'publish' && <Dialog open onOpenChange={open => { if (!open) closeModal(); }}><DialogContent className="qp-modal" showCloseButton={false}><DialogHeader><DialogTitle>{t('Relire avant publication', 'Review before publication')}</DialogTitle><DialogDescription>{t('La publication fige le contenu. Elle n’envoie pas le devis.', 'Publication freezes the content. It does not send the Quote.')}</DialogDescription></DialogHeader>
      <div className="qp-publication-summary"><FileText /><h2>{quote.title}</h2><p>{quote.customerName || t('Destinataire manquant', 'Missing Customer')}</p><strong>CHF {formatMoney(sum.total)}</strong><p>{quote.reference} · {t('Révision', 'Revision')} {revisions.length + 1}</p></div>
      <ul className="qp-publication-checks"><li>{sum.total !== null ? <Check /> : <TriangleAlert />}{t('Toutes les lignes sont chiffrées', 'Every line is priced')}</li><li>{!missingAdmin ? <Check /> : <TriangleAlert />}{t('Coordonnées et informations requises', 'Contact details and required information')}</li><li>{save === 'saved' ? <Check /> : <TriangleAlert />}{t('Modifications enregistrées', 'Changes saved')}</li><li>{ai !== 'processing' ? <Check /> : <TriangleAlert />}{t('Aucune modification IA en attente', 'No AI change pending')}</li></ul>
      {blocked ? <Alert><TriangleAlert /><AlertTitle>{t('Publication indisponible', 'Publication unavailable')}</AlertTitle><AlertDescription>{t('Complétez les points signalés puis revenez à cette relecture.', 'Complete the flagged points, then return to this review.')}<ul>{[...calculation.errors, ...calculation.missing].map((problem, i) => <li key={i}>{problemLabel(problem, locale)}</li>)}</ul></AlertDescription></Alert> : <p>{t('Cette révision ne pourra être ni modifiée ni annulée. Une correction nécessitera une nouvelle révision.', 'This revision cannot be edited or undone. A correction requires a new revision.')}</p>}
      <div className="qp-modal-actions"><Button variant="outline" onClick={closeModal}>{t('Retour au devis', 'Back to Quote')}</Button><Button disabled={blocked} onClick={() => void publish()}><LockKeyhole data-icon="inline-start" />{t('Confirmer la publication', 'Confirm publication')}</Button></div>
    </DialogContent></Dialog>}
  </div>;
}
