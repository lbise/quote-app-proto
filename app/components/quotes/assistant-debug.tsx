import { Fragment } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import type { QuoteAssistantDiagnostic, QuoteAssistantSuccessDebug, QuoteAssistantToolAttempt } from '../../lib/quote-assistant-debug';

type AssistantDebugProps = {
  locale: 'en' | 'fr';
  debug?: QuoteAssistantDiagnostic | null;
  toolDebug?: QuoteAssistantSuccessDebug | null;
};

const requestsFrom = (value: QuoteAssistantDiagnostic | QuoteAssistantSuccessDebug) => value.llmRequests ?? (value.llmRequest ? [value.llmRequest] : []);

export function AssistantDebug({ locale, debug, toolDebug }: AssistantDebugProps) {
  const value = debug ?? toolDebug;
  if (!value) return null;

  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const outcomeLabel = (outcome?: string) => outcome === 'committed' || outcome === 'committed_with_failed_calls' ? t('enregistré', 'committed') : outcome === 'unchanged' || outcome === 'unchanged_with_failed_calls' ? t('inchangé', 'unchanged') : outcome === 'discarded' ? t('abandonné', 'discarded') : outcome ?? '—';
  const isFailure = Boolean(debug);
  const attempts = value.attempts ?? [];
  const requests = requestsFrom(value);
  const warning = t(
    'Données de débogage sensibles : ces requêtes et appels d’outils peuvent contenir le brouillon complet, les coordonnées du client et de l’entreprise, ainsi que la conversation. Seules les personnes autorisées à consulter ce devis peuvent les voir ici. Ces données sont temporaires et ne sont pas conservées dans les journaux de l’application. Les identifiants secrets sont exclus. Ne partagez pas ce panneau sans retirer les données personnelles et confidentielles.',
    'Sensitive debug data: these requests and tool calls may contain the complete Working Draft, Customer and business details, and conversation. Only authorized Quote viewers can see them here. They are temporary and are not stored in application logs. Credentials are excluded. Do not share this panel without removing personal and confidential data.',
  );

  return <Dialog>
    <DialogTrigger asChild>
      <Button variant="outline" size="sm">{isFailure ? t('Détails développeur', 'Developer details') : t('Détails du tour (débogage)', 'Turn details (debug)')}</Button>
    </DialogTrigger>
    <DialogContent className="qp-modal qp-assistant-debug-modal">
      <DialogHeader>
        <DialogTitle>{isFailure ? t('Détails développeur', 'Developer details') : t('Détails du tour (débogage)', 'Turn details (debug)')}</DialogTitle>
        <DialogDescription>{t('Ces informations sont temporaires et peuvent contenir des données sensibles.', 'This information is temporary and may contain sensitive data.')}</DialogDescription>
      </DialogHeader>
      <div className="qp-assistant-debug">
        <p className="qp-assistant-debug-warning">{warning}</p>
        {toolDebug ? <ToolDebugContent debug={toolDebug} t={t} outcomeLabel={outcomeLabel} attempts={attempts} requests={requests} /> : debug && <FailureDebugContent debug={debug} t={t} outcomeLabel={outcomeLabel} attempts={attempts} requests={requests} />}
      </div>
    </DialogContent>
  </Dialog>;
}

type DebugText = (fr: string, en: string) => string;

type DebugContentProps = {
  t: DebugText;
  outcomeLabel: (outcome?: string) => string;
  attempts: QuoteAssistantToolAttempt[];
  requests: NonNullable<QuoteAssistantDiagnostic['llmRequests']>;
};

function ToolDebugContent({ debug, t, outcomeLabel, attempts, requests }: DebugContentProps & { debug: QuoteAssistantSuccessDebug }) {
  return <>
    {debug.failedCalls !== undefined && <p>{t(`Appels d’outil en échec : ${debug.failedCalls}/${debug.failureLimit ?? 3}`, `Failed calls: ${debug.failedCalls}/${debug.failureLimit ?? 3}`)}</p>}
    {debug.outcome && <p>{t('Résultat du tour', 'Turn outcome')}: {outcomeLabel(debug.outcome)}</p>}
    {debug.toolCalls.map((call, index) => <div key={`tool-${call.name}-${index}`}><strong>{t(`Appel d’outil : ${call.name}`, `Tool call: ${call.name}`)}</strong><pre>{JSON.stringify(call, null, 2)}</pre></div>)}
    {attempts.map((attempt, index) => <div key={`${attempt.name}-${index}`}><strong>{t(`Appel d’outil : ${attempt.name}. Résultat : ${attempt.outcome}`, `Tool call: ${attempt.name}. Outcome: ${attempt.outcome}`)}</strong><pre>{JSON.stringify(attempt, null, 2)}</pre></div>)}
    {requests.map((request, index) => <div key={`request-${index}`}><strong>{t(`Requête application ${index + 1}`, `Application request ${index + 1}`)}</strong><pre>{JSON.stringify(request, null, 2)}</pre></div>)}
    {debug.finalValidation && <p>{t('Validation finale', 'Final validation')}: {debug.finalValidation.outcome}{debug.finalValidation.code ? ` (${debug.finalValidation.code})` : ''}</p>}
    {debug.requestId && <p>{t('Requête', 'Request')}: <code>{debug.requestId}</code></p>}
  </>;
}

function FailureDebugContent({ debug, t, outcomeLabel, attempts, requests }: DebugContentProps & { debug: QuoteAssistantDiagnostic }) {
  return <dl>
    <dt>{t('Phase', 'Phase')}</dt><dd><code>{debug.phase}</code></dd>
    <dt>{t('Code', 'Code')}</dt><dd><code>{debug.code}</code></dd>
    {debug.failedCalls !== undefined && <><dt>{t('Compteur', 'Counter')}</dt><dd>{t(`Appels d’outil en échec : ${debug.failedCalls}/${debug.failureLimit ?? 3}`, `Failed calls: ${debug.failedCalls}/${debug.failureLimit ?? 3}`)}</dd></>}
    {debug.outcome && <><dt>{t('Résultat du tour', 'Turn outcome')}</dt><dd>{outcomeLabel(debug.outcome)}</dd></>}
    {debug.tool && <><dt>{t('Outil', 'Tool')}</dt><dd><code>{debug.tool}</code></dd></>}
    {attempts.map((attempt, index) => <Fragment key={`${attempt.name}-${index}`}><dt>{t('Appel', 'Attempt')}</dt><dd>{t(`Appel d’outil : ${attempt.name}. Résultat : ${attempt.outcome}`, `Tool call: ${attempt.name}. Outcome: ${attempt.outcome}`)}<pre>{JSON.stringify(attempt, null, 2)}</pre></dd></Fragment>)}
    {debug.toolCall && <><dt>{t('Appel complet', 'Full tool call')}</dt><dd><pre>{JSON.stringify(debug.toolCall, null, 2)}</pre></dd></>}
    {requests.map((request, index) => <Fragment key={`request-${index}`}><dt>{t(`Requête LLM ${index + 1}`, `LLM request ${index + 1}`)}</dt><dd><pre>{JSON.stringify(request, null, 2)}</pre></dd></Fragment>)}
    {!debug.llmRequest && !debug.llmRequests?.length && <><dt>{t('Envoi', 'Sent')}</dt><dd>{t('Non transmis au fournisseur', 'Not sent to the provider')}</dd></>}
    {debug.applicationContext !== undefined && <><dt>{t('Entrée application', 'Application input')}</dt><dd><pre>{JSON.stringify(debug.applicationContext, null, 2)}</pre></dd></>}
    {debug.requestId && <><dt>{t('Requête', 'Request')}</dt><dd><code>{debug.requestId}</code></dd></>}
  </dl>;
}
