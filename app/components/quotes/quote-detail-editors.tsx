import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../ui/field';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { calculateQuote, type QuoteData } from '../../lib/quote';
import './editor-layout.css';
import { focusEditorField, QuoteField } from './quote-validation';

type Locale = 'en' | 'fr';
type Props = { quote: QuoteData; locale: Locale; onApply: (quote: QuoteData) => void; onClose: () => void; focusField?: string };
const text = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;
const invalid = (quote: QuoteData, field: keyof QuoteData) => calculateQuote(quote).errors.some(problem => problem.path === field);

function EditorDialog({ title, description, children, onClose, focusId }: { title: string; description: string; children: ReactNode; onClose: () => void; focusId?: string }) {
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="qp-modal qp-editor-dialog" showCloseButton={false} onOpenAutoFocus={focusEditorField(focusId)}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
function Actions({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  return <DialogFooter className="qp-editor-footer"><Button type="button" variant="outline" onClick={onClose}>{text(locale, 'Annuler', 'Cancel')}</Button><Button type="submit">{text(locale, 'Appliquer', 'Apply')}</Button></DialogFooter>;
}

export function BusinessQuoteEditor({ quote, locale, onApply, onClose, onSettings, focusField }: Props & { onSettings: () => void }) {
  const [draft, setDraft] = useState(quote);
  const [defaults, setDefaults] = useState<Partial<QuoteData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const calculation = calculateQuote(draft);
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
  function update(patch: Partial<QuoteData>) { setDraft(current => ({ ...current, ...patch })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = (['businessName', 'businessAddress', 'businessContact', 'vatRegistered', 'vatId'] as const).find(field => invalid(draft, field));
    if (problem) { document.getElementById(`business-${problem}`)?.focus(); return; }
    onApply(draft); onClose();
  }
  return <EditorDialog focusId={focusField ? `business-${focusField}` : undefined} title={text(locale, 'Votre entreprise sur ce devis', 'Business details for this Quote')} description={text(locale, 'Ces coordonnées et le statut TVA ne changent que ce brouillon. Les valeurs par défaut et les révisions publiées restent inchangées.', 'These details and VAT status change this Working Draft only. Defaults and Published Revisions stay unchanged.')} onClose={onClose}>
    <form className="qp-editor-form" onSubmit={submit} noValidate>
      <div className="qp-editor-body">
      <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={loading || loadError} onClick={() => defaults && update({ businessName: defaults.businessName ?? '', businessAddress: defaults.businessAddress ?? '', businessContact: defaults.businessContact ?? '', vatRegistered: defaults.vatRegistered ?? null, vatId: defaults.vatId ?? '' })}>{text(locale, 'Rétablir les valeurs par défaut', 'Restore from business settings')}</Button><Button type="button" variant="link" onClick={onSettings}>{text(locale, 'Gérer les valeurs par défaut', 'Manage defaults')}</Button></div>
      {loading && <p role="status">{text(locale, 'Chargement des valeurs par défaut…', 'Loading defaults…')}</p>}
      {loadError && <div role="alert">{text(locale, 'Valeurs par défaut indisponibles.', 'Defaults unavailable.')} <Button type="button" variant="outline" onClick={() => void load()}>{text(locale, 'Réessayer', 'Retry')}</Button></div>}
      <FieldGroup>
        <QuoteField calculation={calculation} path="businessName" id="business-businessName" locale={locale}><FieldLabel htmlFor="business-businessName">{text(locale, 'Raison sociale', 'Business name')}</FieldLabel><Input id="business-businessName" value={draft.businessName} onChange={e => update({ businessName: e.target.value })} /></QuoteField>
        <QuoteField calculation={calculation} path="businessAddress" id="business-businessAddress" locale={locale}><FieldLabel htmlFor="business-businessAddress">{text(locale, 'Adresse', 'Address')}</FieldLabel><Textarea id="business-businessAddress" value={draft.businessAddress} onChange={e => update({ businessAddress: e.target.value })} /></QuoteField>
        <QuoteField calculation={calculation} path="businessContact" id="business-businessContact" locale={locale}><FieldLabel htmlFor="business-businessContact">{text(locale, 'Coordonnées', 'Contact details')}</FieldLabel><Input id="business-businessContact" value={draft.businessContact} onChange={e => update({ businessContact: e.target.value })} /></QuoteField>
        <QuoteField calculation={calculation} path="vatRegistered" id="business-vatRegistered" locale={locale}><FieldLabel htmlFor="business-vatRegistered">{text(locale, 'Assujetti à la TVA', 'VAT registered')}</FieldLabel><select id="business-vatRegistered" value={draft.vatRegistered === null ? 'unknown' : draft.vatRegistered ? 'yes' : 'no'} aria-describedby="business-vat-help" onChange={e => update({ vatRegistered: e.target.value === 'unknown' ? null : e.target.value === 'yes' })}><option value="unknown">{text(locale, 'À préciser', 'To confirm')}</option><option value="yes">{text(locale, 'Oui', 'Yes')}</option><option value="no">{text(locale, 'Non', 'No')}</option></select><FieldDescription id="business-vat-help">{text(locale, 'Seul le taux normal de 8,1 % est pris en charge.', 'Only the 8.1% standard rate is supported.')}</FieldDescription></QuoteField>
        <QuoteField calculation={calculation} path="vatId" id="business-vatId" locale={locale}><FieldLabel htmlFor="business-vatId">{text(locale, 'Numéro TVA', 'VAT identifier')}</FieldLabel><Input id="business-vatId" value={draft.vatId} onChange={e => update({ vatId: e.target.value })} /></QuoteField>
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

export function DiscountQuoteEditor({ quote, locale, onApply, onClose, focusField }: Props) {
  const [mode, setMode] = useState(quote.discountMode);
  const [discount, setDiscount] = useState(quote.discount);
  const calculation = calculateQuote({ ...quote, discountMode: mode, discount });
  function submit(event: FormEvent) { event.preventDefault(); const next = { ...quote, discountMode: mode, discount: mode === 'none' ? '0' : discount }; if (invalid(next, 'discount')) { document.getElementById('quote-discount-edit')?.focus(); return; } onApply(next); onClose(); }
  return <EditorDialog focusId={focusField === 'discount' ? 'quote-discount-edit' : focusField === 'discountMode' ? 'quote-discount-mode' : undefined} title={text(locale, 'Remise du devis', 'Quote discount')} description={text(locale, 'La remise est déduite avant la TVA.', 'The discount is deducted before VAT.')} onClose={onClose}><form className="qp-editor-form" onSubmit={submit} noValidate><div className="qp-editor-body"><FieldGroup><Field><FieldLabel htmlFor="quote-discount-mode">{text(locale, 'Remise', 'Discount')}</FieldLabel><select id="quote-discount-mode" value={mode} onChange={e => { setMode(e.target.value as QuoteData['discountMode']); }}><option value="none">{text(locale, 'Aucune', 'None')}</option><option value="percent">{text(locale, 'Pourcentage', 'Percentage')}</option><option value="fixed">{text(locale, 'Montant fixe', 'Fixed amount')}</option></select></Field>{mode !== 'none' && <QuoteField calculation={calculation} path="discount" id="quote-discount-edit" locale={locale}><FieldLabel htmlFor="quote-discount-edit">{text(locale, 'Valeur', 'Value')}</FieldLabel><Input id="quote-discount-edit" inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value)} /></QuoteField>}</FieldGroup></div><Actions locale={locale} onClose={onClose} /></form></EditorDialog>;
}

function dateAfter(issue: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue)) return '';
  const date = new Date(`${issue}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== issue) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function QuoteMetadataPopover({ quote, locale, lockedReference, onApply, children, focusField }: { quote: QuoteData; locale: Locale; lockedReference: boolean; onApply: (next: QuoteData) => void; children: ReactNode; focusField?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(quote);
  const calculation = calculateQuote(draft);
  function submit(event: FormEvent) { event.preventDefault(); const problem = (['reference', 'issueDate', 'validUntil'] as const).find(field => invalid(draft, field)); if (problem) { document.getElementById(`metadata-${problem}`)?.focus(); return; } onApply(draft); setOpen(false); }
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setDraft(quote); }}><PopoverTrigger asChild>{children}</PopoverTrigger><PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]" lang={locale} onOpenAutoFocus={focusEditorField(focusField ? `metadata-${focusField}` : undefined)}><h3 className="font-medium">{text(locale, 'Référence et dates', 'Reference and dates')}</h3><form className="flex flex-col gap-3" onSubmit={submit} noValidate><FieldGroup>
    <QuoteField calculation={calculation} path="reference" id="metadata-reference" locale={locale} disabled={lockedReference}><FieldLabel htmlFor="metadata-reference">{text(locale, 'Référence', 'Reference')}</FieldLabel><Input id="metadata-reference" disabled={lockedReference} value={draft.reference} onChange={e => setDraft(current => ({ ...current, reference: e.target.value }))} />{lockedReference && <FieldDescription>{text(locale, 'Verrouillée après publication.', 'Locked after publication.')}</FieldDescription>}</QuoteField>
    <QuoteField calculation={calculation} path="issueDate" id="metadata-issueDate" locale={locale}><FieldLabel htmlFor="metadata-issueDate">{text(locale, 'Date d’émission', 'Issue date')}</FieldLabel><Input id="metadata-issueDate" type="date" value={draft.issueDate} onChange={e => setDraft(current => ({ ...current, issueDate: e.target.value }))} /><div className="flex flex-wrap gap-1"><Button type="button" variant="outline" size="sm" onClick={() => {
      const today = new Date();
      const issueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      setDraft(current => ({ ...current, issueDate }));
    }}>{text(locale, 'Aujourd’hui', 'Today')}</Button></div></QuoteField>
    <QuoteField calculation={calculation} path="validUntil" id="metadata-validUntil" locale={locale}><FieldLabel htmlFor="metadata-validUntil">{text(locale, 'Valable jusqu’au', 'Valid until')}</FieldLabel><Input id="metadata-validUntil" type="date" value={draft.validUntil} onChange={e => setDraft(current => ({ ...current, validUntil: e.target.value }))} /></QuoteField>
    </FieldGroup><div className="flex flex-wrap gap-1">{[15, 30, 60].map(days => <Button type="button" key={days} size="sm" variant="outline" disabled={!dateAfter(draft.issueDate, days)} onClick={() => setDraft(current => ({ ...current, validUntil: dateAfter(current.issueDate, days) }))}>+{days} {text(locale, 'jours', 'days')}</Button>)}</div><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>{text(locale, 'Annuler', 'Cancel')}</Button><Button type="submit">{text(locale, 'Appliquer', 'Apply')}</Button></div></form></PopoverContent></Popover>;
}
