import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { calculateQuote, type QuoteData } from '../../lib/quote';
import './editor-layout.css';

type Locale = 'en' | 'fr';
type Props = { quote: QuoteData; locale: Locale; onApply: (quote: QuoteData) => void; onClose: () => void };
const text = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;
const invalid = (quote: QuoteData, field: keyof QuoteData) => calculateQuote(quote).errors.some(problem => problem.path === field);

function EditorDialog({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="qp-modal qp-editor-dialog" showCloseButton={false}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
function Actions({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  return <DialogFooter className="qp-editor-footer"><Button type="button" variant="outline" onClick={onClose}>{text(locale, 'Annuler', 'Cancel')}</Button><Button type="submit">{text(locale, 'Appliquer', 'Apply')}</Button></DialogFooter>;
}

export function BusinessQuoteEditor({ quote, locale, onApply, onClose, onSettings }: Props & { onSettings: () => void }) {
  const [draft, setDraft] = useState(quote);
  const [defaults, setDefaults] = useState<Partial<QuoteData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  async function load(signal?: AbortSignal) {
    setLoading(true); setLoadError(false);
    try {
      const response = await fetch('/api/quotes', { signal });
      if (!response.ok) throw new Error('load');
      const result = await response.json() as { defaults?: Partial<QuoteData> };
      setDefaults(result.defaults ?? {});
    } catch { if (!signal?.aborted) setLoadError(true); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  function update(patch: Partial<QuoteData>) { setDraft(current => ({ ...current, ...patch })); setShowErrors(false); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = (['businessName', 'businessAddress', 'businessContact', 'vatRegistered', 'vatId'] as const).find(field => invalid(draft, field));
    if (problem) { setShowErrors(true); document.getElementById(`business-${problem}`)?.focus(); return; }
    onApply(draft); onClose();
  }
  return <EditorDialog title={text(locale, 'Votre entreprise sur ce devis', 'Business details for this Quote')} description={text(locale, 'Ces coordonnées et le statut TVA ne changent que ce brouillon. Les valeurs par défaut et les révisions publiées restent inchangées.', 'These details and VAT status change this Working Draft only. Defaults and Published Revisions stay unchanged.')} onClose={onClose}>
    <form className="qp-editor-form" onSubmit={submit} noValidate>
      <div className="qp-editor-body">
      <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={loading || loadError} onClick={() => defaults && update({ businessName: defaults.businessName ?? '', businessAddress: defaults.businessAddress ?? '', businessContact: defaults.businessContact ?? '', vatRegistered: defaults.vatRegistered ?? null, vatId: defaults.vatId ?? '' })}>{text(locale, 'Rétablir les valeurs par défaut', 'Restore from business settings')}</Button><Button type="button" variant="link" onClick={onSettings}>{text(locale, 'Gérer les valeurs par défaut', 'Manage defaults')}</Button></div>
      {loading && <p role="status">{text(locale, 'Chargement des valeurs par défaut…', 'Loading defaults…')}</p>}
      {loadError && <div role="alert">{text(locale, 'Valeurs par défaut indisponibles.', 'Defaults unavailable.')} <Button type="button" variant="outline" onClick={() => void load()}>{text(locale, 'Réessayer', 'Retry')}</Button></div>}
      <FieldGroup>
        <Field data-invalid={showErrors && invalid(draft, 'businessName') || undefined}><FieldLabel htmlFor="business-businessName">{text(locale, 'Raison sociale', 'Business name')}</FieldLabel><Input id="business-businessName" value={draft.businessName} aria-invalid={showErrors && invalid(draft, 'businessName')} onChange={e => update({ businessName: e.target.value })} />{showErrors && invalid(draft, 'businessName') && <FieldError>{text(locale, 'Indiquez la raison sociale.', 'Enter the business name.')}</FieldError>}</Field>
        <Field data-invalid={showErrors && invalid(draft, 'businessAddress') || undefined}><FieldLabel htmlFor="business-businessAddress">{text(locale, 'Adresse', 'Address')}</FieldLabel><Textarea id="business-businessAddress" value={draft.businessAddress} aria-invalid={showErrors && invalid(draft, 'businessAddress')} onChange={e => update({ businessAddress: e.target.value })} />{showErrors && invalid(draft, 'businessAddress') && <FieldError>{text(locale, 'Indiquez une adresse.', 'Enter an address.')}</FieldError>}</Field>
        <Field data-invalid={showErrors && invalid(draft, 'businessContact') || undefined}><FieldLabel htmlFor="business-businessContact">{text(locale, 'Coordonnées', 'Contact details')}</FieldLabel><Input id="business-businessContact" value={draft.businessContact} aria-invalid={showErrors && invalid(draft, 'businessContact')} onChange={e => update({ businessContact: e.target.value })} />{showErrors && invalid(draft, 'businessContact') && <FieldError>{text(locale, 'Indiquez des coordonnées.', 'Enter contact details.')}</FieldError>}</Field>
        <Field data-invalid={showErrors && invalid(draft, 'vatRegistered') || undefined}><FieldLabel htmlFor="business-vatRegistered">{text(locale, 'Assujetti à la TVA', 'VAT registered')}</FieldLabel><select id="business-vatRegistered" value={draft.vatRegistered === null ? 'unknown' : draft.vatRegistered ? 'yes' : 'no'} aria-invalid={showErrors && invalid(draft, 'vatRegistered')} onChange={e => update({ vatRegistered: e.target.value === 'unknown' ? null : e.target.value === 'yes' })}><option value="unknown">{text(locale, 'À préciser', 'To confirm')}</option><option value="yes">{text(locale, 'Oui', 'Yes')}</option><option value="no">{text(locale, 'Non', 'No')}</option></select><FieldDescription>{text(locale, 'Seul le taux normal de 8,1 % est pris en charge.', 'Only the 8.1% standard rate is supported.')}</FieldDescription></Field>
        <Field data-invalid={showErrors && invalid(draft, 'vatId') || undefined}><FieldLabel htmlFor="business-vatId">{text(locale, 'Numéro TVA', 'VAT identifier')}</FieldLabel><Input id="business-vatId" value={draft.vatId} aria-invalid={showErrors && invalid(draft, 'vatId')} onChange={e => update({ vatId: e.target.value })} />{draft.vatRegistered && !draft.vatId.trim() && <FieldDescription>{text(locale, 'À compléter avant publication.', 'Required before publication.')}</FieldDescription>}</Field>
      </FieldGroup></div><Actions locale={locale} onClose={onClose} />
    </form>
  </EditorDialog>;
}

export function SiteQuoteEditor({ quote, locale, onApply, onClose }: Props) {
  const [siteAddress, setSiteAddress] = useState(quote.siteAddress);
  return <EditorDialog title={text(locale, 'Adresse du chantier', 'Site address')} description={text(locale, 'Le chantier peut se trouver à une autre adresse que le client.', 'The work site may differ from the Customer address.')} onClose={onClose}><form className="qp-editor-form" onSubmit={e => { e.preventDefault(); onApply({ ...quote, siteAddress }); onClose(); }}><div className="qp-editor-body"><Button type="button" variant="outline" disabled={!quote.customerAddress.trim()} onClick={() => setSiteAddress(quote.customerAddress)}>{text(locale, 'Copier l’adresse du client', 'Copy Customer address')}</Button><FieldGroup><Field><FieldLabel htmlFor="site-address">{text(locale, 'Adresse du chantier', 'Site address')}</FieldLabel><Textarea id="site-address" value={siteAddress} onChange={e => setSiteAddress(e.target.value)} /></Field></FieldGroup></div><Actions locale={locale} onClose={onClose} /></form></EditorDialog>;
}

export function TermsQuoteEditor({ quote, locale, onApply, onClose }: Props) {
  const [terms, setTerms] = useState(quote.terms);
  const [defaults, setDefaults] = useState<Partial<QuoteData> | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => { const controller = new AbortController(); fetch('/api/quotes', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('load'); return response.json(); }).then((data: { defaults?: Partial<QuoteData> }) => setDefaults(data.defaults ?? {})).catch(() => { if (!controller.signal.aborted) setLoadError(true); }); return () => controller.abort(); }, []);
  return <EditorDialog title={text(locale, 'Conditions du devis', 'Quote terms')} description={text(locale, 'Les conditions de ce devis sont indépendantes des conditions par défaut.', 'Terms on this Quote are independent of the default terms.')} onClose={onClose}><form className="qp-editor-form" onSubmit={e => { e.preventDefault(); onApply({ ...quote, terms }); onClose(); }}><div className="qp-editor-body"><Button type="button" variant="outline" disabled={!defaults} onClick={() => setTerms(defaults?.terms ?? '')}>{text(locale, 'Rétablir les conditions par défaut', 'Restore default terms')}</Button>{loadError && <p role="alert">{text(locale, 'Conditions par défaut indisponibles. Réouvrez cette fenêtre pour réessayer.', 'Default terms unavailable. Reopen to retry.')}</p>}<FieldGroup><Field><FieldLabel htmlFor="quote-terms-edit">{text(locale, 'Conditions', 'Terms')}</FieldLabel><Textarea id="quote-terms-edit" value={terms} onChange={e => setTerms(e.target.value)} /></Field></FieldGroup></div><Actions locale={locale} onClose={onClose} /></form></EditorDialog>;
}

export function DiscountQuoteEditor({ quote, locale, onApply, onClose }: Props) {
  const [mode, setMode] = useState(quote.discountMode);
  const [discount, setDiscount] = useState(quote.discount);
  const [error, setError] = useState(false);
  function submit(event: FormEvent) { event.preventDefault(); const next = { ...quote, discountMode: mode, discount: mode === 'none' ? '0' : discount }; if (invalid(next, 'discount')) { setError(true); document.getElementById('quote-discount-edit')?.focus(); return; } onApply(next); onClose(); }
  return <EditorDialog title={text(locale, 'Remise du devis', 'Quote discount')} description={text(locale, 'La remise est déduite avant la TVA.', 'The discount is deducted before VAT.')} onClose={onClose}><form className="qp-editor-form" onSubmit={submit} noValidate><div className="qp-editor-body"><FieldGroup><Field><FieldLabel htmlFor="quote-discount-mode">{text(locale, 'Remise', 'Discount')}</FieldLabel><select id="quote-discount-mode" value={mode} onChange={e => { setMode(e.target.value as QuoteData['discountMode']); setError(false); }}><option value="none">{text(locale, 'Aucune', 'None')}</option><option value="percent">{text(locale, 'Pourcentage', 'Percentage')}</option><option value="fixed">{text(locale, 'Montant fixe', 'Fixed amount')}</option></select></Field>{mode !== 'none' && <Field data-invalid={error || undefined}><FieldLabel htmlFor="quote-discount-edit">{text(locale, 'Valeur', 'Value')}</FieldLabel><Input id="quote-discount-edit" inputMode="decimal" value={discount} aria-invalid={error} onChange={e => { setDiscount(e.target.value); setError(false); }} />{error && <FieldError>{text(locale, 'La remise doit être comprise entre zéro et le sous-total.', 'Discount must be between zero and the subtotal.')}</FieldError>}</Field>}</FieldGroup></div><Actions locale={locale} onClose={onClose} /></form></EditorDialog>;
}

function dateAfter(issue: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue)) return '';
  const date = new Date(`${issue}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== issue) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function QuoteMetadataPopover({ quote, locale, lockedReference, onApply, children }: { quote: QuoteData; locale: Locale; lockedReference: boolean; onApply: (next: QuoteData) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(quote);
  const [error, setError] = useState(false);
  function submit(event: FormEvent) { event.preventDefault(); const problem = (['reference', 'issueDate', 'validUntil'] as const).find(field => invalid(draft, field)); if (problem) { setError(true); document.getElementById(`metadata-${problem}`)?.focus(); return; } onApply(draft); setOpen(false); }
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) { setDraft(quote); setError(false); } }}><PopoverTrigger asChild>{children}</PopoverTrigger><PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]" lang={locale}><h3 className="font-medium">{text(locale, 'Référence et dates', 'Reference and dates')}</h3><form className="flex flex-col gap-3" onSubmit={submit} noValidate><FieldGroup>
    <Field data-disabled={lockedReference || undefined} data-invalid={error && invalid(draft, 'reference') || undefined}><FieldLabel htmlFor="metadata-reference">{text(locale, 'Référence', 'Reference')}</FieldLabel><Input id="metadata-reference" disabled={lockedReference} value={draft.reference} aria-invalid={error && invalid(draft, 'reference')} onChange={e => setDraft(current => ({ ...current, reference: e.target.value }))} />{lockedReference && <FieldDescription>{text(locale, 'Verrouillée après publication.', 'Locked after publication.')}</FieldDescription>}</Field>
    <Field data-invalid={error && invalid(draft, 'issueDate') || undefined}><FieldLabel htmlFor="metadata-issueDate">{text(locale, 'Date d’émission', 'Issue date')}</FieldLabel><Input id="metadata-issueDate" type="date" value={draft.issueDate} aria-invalid={error && invalid(draft, 'issueDate')} onChange={e => setDraft(current => ({ ...current, issueDate: e.target.value }))} />{error && invalid(draft, 'issueDate') && <FieldError>{text(locale, 'Indiquez une date valide.', 'Enter a valid date.')}</FieldError>}</Field>
    <Field data-invalid={error && invalid(draft, 'validUntil') || undefined}><FieldLabel htmlFor="metadata-validUntil">{text(locale, 'Valable jusqu’au', 'Valid until')}</FieldLabel><Input id="metadata-validUntil" type="date" value={draft.validUntil} aria-invalid={error && invalid(draft, 'validUntil')} onChange={e => setDraft(current => ({ ...current, validUntil: e.target.value }))} />{error && invalid(draft, 'validUntil') && <FieldError>{text(locale, 'Indiquez une date valide.', 'Enter a valid date.')}</FieldError>}</Field>
    </FieldGroup><div className="flex flex-wrap gap-1">{[15, 30, 60].map(days => <Button type="button" key={days} size="sm" variant="outline" disabled={!dateAfter(draft.issueDate, days)} onClick={() => setDraft(current => ({ ...current, validUntil: dateAfter(current.issueDate, days) }))}>+{days} {text(locale, 'jours', 'days')}</Button>)}</div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>{text(locale, 'Annuler', 'Cancel')}</Button><Button type="submit">{text(locale, 'Appliquer', 'Apply')}</Button></div></form></PopoverContent></Popover>;
}
