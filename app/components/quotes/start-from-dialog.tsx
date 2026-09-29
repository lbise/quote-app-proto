import { useEffect, useState } from 'react';
import { CopyPlus, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '../ui/field';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { swissAmount } from '../../lib/quote';
import { quoteSourceOptions, quoteVersionName, type QuoteSource, type QuoteSourceOption } from '../../lib/quote-start-from';
import { randomUUID } from '../../lib/random-id';
import { quoteRequest, type QuoteRecord } from './use-quote';

type Locale = 'fr' | 'en';
export type StartFromQuote = { id: string; reference: string };

function describe(option: QuoteSourceOption, locale: Locale) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const date = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', { dateStyle: 'medium' }).format(new Date(option.date));
  const total = option.total === null
    ? t('Total à compléter', 'Total incomplete')
    : `CHF ${swissAmount(option.total)}${option.vatRegistered ? t(' TTC', ' incl. VAT') : ''}`;
  const lines = option.lines === 1 ? t('1 ligne', '1 line') : t(`${option.lines} lignes`, `${option.lines} lines`);
  return {
    name: quoteVersionName(option.source, locale),
    details: [option.source === 'draft' ? t(`Modifié le ${date}`, `Last edited ${date}`) : t(`Publiée le ${date}`, `Published ${date}`), total, lines].join(' · '),
  };
}

/**
 * Asks which version of a Quote a new Quote starts from, when it has more than
 * one. Nothing is preselected. The request key lives until the choice changes
 * or the dialog closes, so retrying after a lost response is safe.
 */
export function StartFromDialog({ locale, quote, onCancel, onConfirm }: {
  locale: Locale;
  quote: StartFromQuote | null;
  onCancel: () => void;
  /** Resolves true once the new Quote exists. */
  onConfirm: (from: QuoteSource, requestId: string) => Promise<boolean>;
}) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const [options, setOptions] = useState<QuoteSourceOption[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState('');
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = quote?.id;

  useEffect(() => {
    setOptions(null); setLoadFailed(false); setChoice(''); setFailed(false); setRequestId(randomUUID());
    if (!id) return;
    let active = true;
    quoteRequest<QuoteRecord>(undefined, id)
      .then(record => { if (active) setOptions(quoteSourceOptions(record)); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [id, attempt]);

  const chosen = options?.find(option => String(option.source) === choice);
  async function confirm() {
    if (!chosen) return;
    setStarting(true); setFailed(false);
    const started = await onConfirm(chosen.source, requestId);
    setStarting(false);
    if (!started) setFailed(true);
  }

  return <Dialog open={quote !== null} onOpenChange={open => { if (!open && !starting) onCancel(); }}>
    <DialogContent className="qp-modal qp-start-from" lang={locale}>
      <DialogHeader>
        <DialogTitle>{t('Nouveau devis à partir de…', 'New Quote from…')}</DialogTitle>
        <DialogDescription>{quote && t(
          `Choisissez la version de ${quote.reference} à reprendre. Les travaux et les prix sont copiés ; le client, l’adresse du chantier et la remise ne le sont pas.`,
          `Choose which version of ${quote.reference} to start from. The work and prices are copied; the Customer, site address and discount are not.`)}</DialogDescription>
      </DialogHeader>
      {!options && !loadFailed && <p role="status">{t('Chargement des versions…', 'Loading versions…')}</p>}
      {loadFailed && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{t('Les versions n’ont pas pu être chargées.', 'The versions could not be loaded.')}<Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>{t('Réessayer', 'Retry')}</Button></AlertDescription></Alert>}
      {options && <RadioGroup value={choice} onValueChange={value => { setChoice(value); setRequestId(randomUUID()); setFailed(false); }} aria-label={t('Version à reprendre', 'Version to start from')} disabled={starting}>
        {options.map(option => {
          const value = String(option.source);
          const { name, details } = describe(option, locale);
          return <FieldLabel key={value} htmlFor={`start-from-${value}`}>
            <Field orientation="horizontal">
              <RadioGroupItem value={value} id={`start-from-${value}`} aria-labelledby={`start-from-${value}-name`} aria-describedby={`start-from-${value}-details`} />
              <FieldContent><FieldTitle id={`start-from-${value}-name`}>{name}</FieldTitle><FieldDescription id={`start-from-${value}-details`}>{details}</FieldDescription></FieldContent>
            </Field>
          </FieldLabel>;
        })}
      </RadioGroup>}
      {failed && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{t('Le nouveau devis n’a pas pu être créé. Vérifiez votre connexion, puis réessayez.', 'The new Quote could not be created. Check your connection, then try again.')}</AlertDescription></Alert>}
      <DialogFooter>
        <Button variant="outline" disabled={starting} onClick={onCancel}>{t('Annuler', 'Cancel')}</Button>
        <Button disabled={!chosen || starting} onClick={() => void confirm()}><CopyPlus data-icon="inline-start" />{starting ? t('Création…', 'Creating…') : t('Créer le devis', 'Create Quote')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
