import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import type { StoredTurnTrace, TurnTraceContext } from '@/lib/turn-traces.server';
import { turnTraceSteps, type TurnTraceModelCall, type TurnTraceToolCall } from '@/lib/turn-trace';
import { AdminShell, DateTime, formatCost, formatNumber, OutcomeBadge, t, type Locale } from './admin-shell';
import { adminQuotePath } from './businesses-page';
import { JsonBlock } from './json-block';

type LanguageChange = (locale: Locale) => Promise<boolean>;
export type AdminTurnTrace = StoredTurnTrace & TurnTraceContext;

const back = (locale: Locale) => ({ to: '/admin/turns', label: t(locale, 'Tours de l’assistant', 'Assistant Turns') });

/** A Turn Trace that is gone: expired after 30 days, deleted with its Quote, or never recorded. */
export function MissingTurnTracePage({ locale, onLanguage }: { locale: Locale; onLanguage: LanguageChange }) {
  return <AdminShell locale={locale} onLanguage={onLanguage} section="turns" back={back(locale)} title={t(locale, 'Trace introuvable', 'Turn Trace not available')}>
    <section className="qp-panel">
      <p className="qp-admin-empty">{t(locale,
        'Cette trace n’est plus disponible. Les traces sont supprimées 30 jours après leur tour, ou avec leur devis.',
        'This Turn Trace is no longer available. Turn Traces are deleted 30 days after their turn, or when their Quote is deleted.')}</p>
    </section>
  </AdminShell>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function tokens(locale: Locale, input: number, output: number) {
  return t(locale, `${formatNumber(locale, input)} en entrée · ${formatNumber(locale, output)} en sortie`, `${formatNumber(locale, input)} in · ${formatNumber(locale, output)} out`);
}

function ModelCallStep({ locale, call }: { locale: Locale; call: TurnTraceModelCall }) {
  const facts = [
    call.model,
    call.latencyMs !== undefined ? `${formatNumber(locale, call.latencyMs)} ms` : null,
    call.usage ? tokens(locale, call.usage.input + call.usage.cacheRead + call.usage.cacheWrite, call.usage.output) : null,
    call.usage ? formatCost(locale, call.usage.costUsd) : null,
  ].filter(Boolean);
  return <li className="qp-trace-step" data-kind="model">
    <header>
      <h3>{t(locale, `Appel au modèle ${call.sequence}`, `Model call ${call.sequence}`)}</h3>
      <p>{facts.join(' · ')}</p>
    </header>
    {call.error && <p className="qp-trace-error">{call.error}</p>}
    <div className="qp-trace-blocks">
      {call.payload !== undefined
        ? <JsonBlock locale={locale} label={t(locale, 'Requête envoyée au fournisseur', 'Provider payload')} value={call.payload} />
        : call.context !== undefined && <JsonBlock locale={locale} label={t(locale, 'Contexte, non envoyé', 'Context, not sent')} value={call.context} />}
      {call.response !== undefined && <JsonBlock locale={locale} label={t(locale, 'Réponse du fournisseur', 'Provider response')} value={call.response} />}
      <JsonBlock locale={locale} label={t(locale, 'Paramètres et usage', 'Settings and usage')} value={{ provider: call.provider, model: call.model, startedAt: call.startedAt, latencyMs: call.latencyMs, settings: call.settings, usage: call.usage }} />
    </div>
  </li>;
}

function ToolCallStep({ locale, call }: { locale: Locale; call: TurnTraceToolCall }) {
  return <li className="qp-trace-step" data-kind="tool" data-outcome={call.outcome}>
    <header>
      <h3>{t(locale, 'Outil', 'Tool call')} <code>{call.name}</code></h3>
      <p>
        <Badge variant={call.outcome === 'rejected' ? 'destructive' : 'secondary'}>{call.outcome === 'rejected' ? t(locale, 'Refusé', 'Rejected') : t(locale, 'Appliqué', 'Applied')}</Badge>
        {call.errorCode && <code>{call.errorCode}</code>}
      </p>
    </header>
    <div className="qp-trace-blocks">
      <JsonBlock locale={locale} label={t(locale, 'Arguments', 'Arguments')} value={call.arguments} />
      <JsonBlock locale={locale} label={call.outcome === 'rejected' ? t(locale, 'Refus renvoyé au modèle', 'Rejection returned to the model') : t(locale, 'Résultat', 'Result')} value={call.result} />
    </div>
  </li>;
}

/** Everything one Assistant Turn sent to and received from the model, in order. */
export function TurnTracePage({ locale, onLanguage, trace }: { locale: Locale; onLanguage: LanguageChange; trace: AdminTurnTrace }) {
  const { detail } = trace;
  const steps = turnTraceSteps(detail);
  return <AdminShell locale={locale} onLanguage={onLanguage} section="turns" back={back(locale)}
    title={t(locale, 'Trace du tour', 'Turn Trace')}
    description={<DateTime locale={locale} value={trace.createdAt} seconds />}
    actions={<OutcomeBadge locale={locale} kind={trace.outcomeKind} />}>
    <section className="qp-panel" aria-labelledby="trace-summary-heading">
      <header className="qp-panel-header"><h2 id="trace-summary-heading">{t(locale, 'Résumé', 'Summary')}</h2></header>
      <dl className="qp-admin-facts">
        <Fact label={t(locale, 'Utilisateur', 'User')}>{trace.user ? <>{trace.user.name} · {trace.user.email}</> : <span className="qp-admin-muted">{t(locale, 'Supprimé', 'Deleted')}</span>}</Fact>
        <Fact label={t(locale, 'Entreprise', 'Business')}><Link className="qp-admin-link" to={`/admin/businesses/${encodeURIComponent(trace.business.id)}`}>{trace.business.name || t(locale, 'Sans nom', 'Unnamed')}</Link></Fact>
        <Fact label={t(locale, 'Devis', 'Quote')}><Link className="qp-admin-link" to={adminQuotePath(trace.quote.id)}>{trace.quote.reference}</Link>{trace.quote.title && <> · {trace.quote.title}</>}</Fact>
        <Fact label={t(locale, 'Résultat', 'Outcome')}><OutcomeBadge locale={locale} kind={trace.outcomeKind} />{trace.reason && <code>{trace.reason}</code>}</Fact>
        <Fact label={t(locale, 'Modèle', 'Model')}>{trace.model ? <>{trace.model}{trace.provider && <span className="qp-admin-muted"> · {trace.provider}</span>}</> : '—'}</Fact>
        <Fact label={t(locale, 'Appels au modèle', 'Model calls')}>{formatNumber(locale, trace.modelCallCount)}</Fact>
        <Fact label={t(locale, 'Jetons', 'Tokens')}>{tokens(locale, trace.inputTokens, trace.outputTokens)}</Fact>
        <Fact label={t(locale, 'Coût', 'Cost')}>{formatCost(locale, trace.costUsd)}</Fact>
        <Fact label={t(locale, 'Version du brouillon', 'Working Draft version')}>{trace.baseVersion ?? '—'} → {trace.resultVersion ?? '—'}</Fact>
        <Fact label={t(locale, 'Langue', 'Language')}>{trace.locale.toUpperCase()}</Fact>
        <Fact label={t(locale, 'Requête', 'Request')}><code>{trace.requestId}</code></Fact>
        {detail.diagnostic && <Fact label={t(locale, 'Diagnostic', 'Diagnostic')}><code>{[detail.diagnostic.phase, detail.diagnostic.code, detail.diagnostic.outcome, detail.diagnostic.tool].filter(Boolean).join(' · ')}</code></Fact>}
      </dl>
    </section>

    <section className="qp-panel" aria-labelledby="trace-messages-heading">
      <header className="qp-panel-header"><h2 id="trace-messages-heading">{t(locale, 'Conversation', 'Conversation')}</h2></header>
      <div className="qp-trace-messages">
        <blockquote data-role="artisan"><span>{t(locale, 'Message de l’artisan', 'Artisan message')}</span><p>{detail.text}</p></blockquote>
        {detail.message
          ? <blockquote data-role={detail.message.role}><span>{detail.message.role === 'note' ? t(locale, 'Note laissée', 'Note left') : t(locale, 'Réponse de l’assistant', 'Assistant reply')}</span><p>{detail.message.text}</p></blockquote>
          : <p className="qp-admin-muted">{t(locale, 'Le tour n’a laissé aucun message.', 'The turn left no message.')}</p>}
      </div>
    </section>

    <section className="qp-panel" aria-labelledby="trace-steps-heading">
      <header className="qp-panel-header">
        <h2 id="trace-steps-heading">{t(locale, 'Appels au modèle et aux outils', 'Model and tool calls')}</h2>
        <p>{t(locale, 'Dans l’ordre. Ouvrez un bloc pour voir le JSON tel qu’il a été enregistré.', 'In order. Open a block to see the JSON as recorded.')}</p>
      </header>
      <div className="qp-trace-blocks qp-trace-preamble">
        <JsonBlock locale={locale} label={t(locale, 'Instructions système', 'System prompt')} value={detail.systemPrompt} />
        {detail.applicationContext !== undefined && <JsonBlock locale={locale} label={t(locale, 'Contexte de l’application', 'Application context')} value={detail.applicationContext} />}
      </div>
      {steps.length === 0
        ? <p className="qp-admin-empty">{t(locale, 'Le tour s’est arrêté avant tout appel au modèle.', 'The turn stopped before any model call.')}</p>
        : <ol className="qp-trace-steps">
          {steps.map((step, index) => step.kind === 'model'
            ? <ModelCallStep key={index} locale={locale} call={step.call} />
            : <ToolCallStep key={index} locale={locale} call={step.call} />)}
        </ol>}
      <div className="qp-trace-blocks qp-trace-preamble">
        <JsonBlock locale={locale} label={t(locale, 'Trace complète', 'Entire Turn Trace')} value={detail} />
      </div>
    </section>
  </AdminShell>;
}
