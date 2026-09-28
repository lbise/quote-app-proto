import { Mic, Square, TriangleAlert, X } from 'lucide-react';

import { formatRecordingTime, RECORDING_LIMIT_MS } from '../../lib/dictation';
import { Button } from '../ui/button';
import type { useDictation } from './use-dictation';

type Dictation = ReturnType<typeof useDictation>;
type Translate = (fr: string, en: string) => string;

/** Tap to start, tap to stop. The button stays visible when the microphone is blocked. */
export function DictationButton({ dictation, t }: { dictation: Dictation; t: Translate }) {
  const { status } = dictation.state;
  if (status === 'recording') {
    return <Button type="button" variant="destructive" size="icon" className="qp-dictation-button" onClick={dictation.stop} aria-label={t('Arrêter l’enregistrement', 'Stop recording')} title={t('Arrêter l’enregistrement', 'Stop recording')}><Square /></Button>;
  }
  const busy = status === 'requesting' || status === 'transcribing' || status === 'failed' || status === 'interrupted';
  return <Button type="button" variant="ghost" size="icon" className="qp-dictation-button" disabled={busy} onClick={() => void dictation.start()} aria-label={t('Dicter un message', 'Dictate a message')} title={t('Dicter un message', 'Dictate a message')}><Mic /></Button>;
}

/** Replaces the keyboard hint while recording or transcribing. */
export function DictationProgress({ dictation, t }: { dictation: Dictation; t: Translate }) {
  const { state } = dictation;
  if (state.status === 'requesting') return <span className="qp-dictation-progress" role="status">{t('Autorisez le microphone…', 'Allow the microphone…')}</span>;
  if (state.status === 'transcribing') {
    return <span className="qp-dictation-progress" role="status"><span className="qp-spinner" />{t('Transcription…', 'Transcription…')}<Button type="button" variant="ghost" size="sm" onClick={dictation.cancel}>{t('Annuler', 'Cancel')}</Button></span>;
  }
  if (state.status !== 'recording') return null;
  const remaining = formatRecordingTime(RECORDING_LIMIT_MS - dictation.elapsedMs + 999);
  return <span className="qp-dictation-progress" data-phase={dictation.phase}>
    <span className="qp-recording-dot" aria-hidden="true" />
    <span role="timer" aria-label={t('Durée de l’enregistrement', 'Recording time')}>{formatRecordingTime(dictation.elapsedMs)}</span>
    {dictation.phase === 'warning'
      ? <span role="status">{t(`Arrêt automatique dans ${remaining}`, `Stops automatically in ${remaining}`)}</span>
      : <span>{t('Enregistrement… 5 min max.', 'Recording… 5 min max.')}</span>}
  </span>;
}

const lostOnClose: [string, string] = ['L’enregistrement est conservé dans cet onglet uniquement. Fermer ou recharger l’onglet le supprime.', 'The recording is kept in this tab only. Closing or reloading the tab loses it.'];

/** Guidance and recovery above the composer. Typing keeps working in every state. */
export function DictationPanel({ dictation, t }: { dictation: Dictation; t: Translate }) {
  const { state } = dictation;
  const kept = <p>{t(...lostOnClose)}</p>;
  if (state.status === 'failed') {
    const title = {
      failed: t('La transcription a échoué', 'Transcription failed'),
      cancelled: t('Transcription annulée', 'Transcription cancelled'),
      spend_limit: t('Limite de dépenses de l’IA atteinte', 'AI spending limit reached'),
      too_large: t('Enregistrement trop volumineux', 'Recording too large'),
      unavailable: t('Transcription indisponible', 'Transcription unavailable'),
    }[state.reason];
    const detail = state.reason === 'spend_limit' ? <p>{t('La limite de dépenses de ce déploiement est atteinte. Contactez l’administrateur ou saisissez votre message.', 'This deployment’s spending limit has been reached. Contact the administrator or type your message.')}</p>
      : state.reason === 'too_large' ? <p>{t('Cet enregistrement dépasse la taille maximale. Enregistrez un message plus court.', 'This recording exceeds the maximum size. Record a shorter message.')}</p>
        : null;
    return <div className="qp-dictation-panel" role="alert"><TriangleAlert /><div><strong>{title}</strong>{detail}{state.reason !== 'too_large' && kept}<div className="qp-dictation-actions">
      {state.reason !== 'too_large' && <Button type="button" size="sm" onClick={dictation.retry}>{t('Réessayer', 'Retry')}</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={dictation.discard}>{t('Supprimer l’enregistrement', 'Discard recording')}</Button>
    </div></div></div>;
  }
  if (state.status === 'interrupted') {
    return <div className="qp-dictation-panel" role="alert"><TriangleAlert /><div><strong>{t('Enregistrement interrompu', 'Recording interrupted')}</strong><p>{t('Ce qui a été capté avant l’interruption peut être transcrit.', 'What was captured before the interruption can be transcribed.')}</p>{kept}<div className="qp-dictation-actions">
      <Button type="button" size="sm" onClick={dictation.retry}>{t('Transcrire', 'Transcribe')}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={dictation.discard}>{t('Supprimer l’enregistrement', 'Discard recording')}</Button>
    </div></div></div>;
  }
  const blocked = state.status === 'idle' ? state.blocked : undefined;
  const notice = state.status === 'idle' || state.status === 'transcribing' ? state.notice : undefined;
  if (blocked) {
    const text = {
      denied: [t('Accès au microphone refusé', 'Microphone access blocked'), t('Pour dicter, autorisez le microphone pour ce site dans les réglages du navigateur (souvent l’icône à gauche de l’adresse), puis touchez à nouveau le microphone. Vous pouvez continuer à saisir votre message.', 'To dictate, allow the microphone for this site in your browser settings (often the icon next to the address), then tap the microphone again. You can keep typing your message.')],
      insecure: [t('Dictée indisponible', 'Dictation unavailable'), t('Le navigateur n’autorise le microphone que sur une connexion sécurisée (HTTPS). Vous pouvez continuer à saisir votre message.', 'The browser allows the microphone only over a secure (HTTPS) connection. You can keep typing your message.')],
      unsupported: [t('Dictée indisponible', 'Dictation unavailable'), t('Ce navigateur ne permet pas d’enregistrer l’audio. Vous pouvez continuer à saisir votre message.', 'This browser cannot record audio. You can keep typing your message.')],
      no_microphone: [t('Aucun microphone trouvé', 'No microphone found'), t('Branchez ou activez un microphone, puis réessayez. Vous pouvez continuer à saisir votre message.', 'Connect or enable a microphone, then try again. You can keep typing your message.')],
      error: [t('Le microphone n’a pas démarré', 'The microphone did not start'), t('Réessayez. Vous pouvez continuer à saisir votre message.', 'Try again. You can keep typing your message.')],
    }[blocked];
    return <div className="qp-dictation-panel" role="alert"><TriangleAlert /><div><strong>{text[0]}</strong><p>{text[1]}</p></div><Button type="button" variant="ghost" size="icon-xs" onClick={dictation.dismiss} aria-label={t('Fermer', 'Dismiss')}><X /></Button></div>;
  }
  if (notice) {
    const text = {
      empty: t('Aucune parole n’a été reconnue.', 'No speech was recognized.'),
      nothing_recorded: t('Rien n’a été enregistré.', 'Nothing was recorded.'),
      limit: t('Enregistrement arrêté à 5 minutes.', 'Recording stopped at 5 minutes.'),
    }[notice];
    return <div className="qp-dictation-panel qp-dictation-notice" role="status"><p>{text}</p>{state.status === 'idle' && <Button type="button" variant="ghost" size="icon-xs" onClick={dictation.dismiss} aria-label={t('Fermer', 'Dismiss')}><X /></Button>}</div>;
  }
  return null;
}
